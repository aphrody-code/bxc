/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Fetch domain handler.
 *
 * Implements CDP Fetch domain for request interception in the static transport:
 *   - Fetch.enable   — activate interception with optional url/resource filters
 *   - Fetch.disable  — deactivate interception
 *   - Fetch.continueRequest   — resume a paused request (optionally modify)
 *   - Fetch.failRequest       — abort a paused request with an error
 *   - Fetch.fulfillRequest    — respond with a mock (responseCode, headers, body)
 *   - Fetch.continueWithAuth  — supply credentials for a 401/407 auth challenge
 *
 * Events fired from StaticDomTransport.#navigate when interception is enabled:
 *   - Fetch.requestPaused  — a request matched a filter and is waiting
 *   - Fetch.authRequired   — a 401/407 was received (stub: never fires for static)
 *
 * How interception works in the static transport
 * ------------------------------------------------
 * When Fetch.enable is called, a FetchInterceptionState is stored for the
 * session.  During Page.navigate (in StaticDomTransport.#navigate), if any
 * registered pattern matches the request URL, a Promise is stored in
 * `pendingRequests` and `Fetch.requestPaused` is emitted.  The agent must then
 * call one of continueRequest / failRequest / fulfillRequest / continueWithAuth
 * to resolve the promise and unblock the navigation.
 *
 * Because the static transport executes a single sequential request per
 * Page.navigate call, only one request can be paused at a time per session.
 */

import type {
	DomainHandler,
	FetchAction,
	FetchInterceptionState,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const FetchHandler: DomainHandler = async (
	method,
	params,
	ctx,
	sessionId,
) => {
	const net = ctx.networkCtx;
	const sid = sessionId ?? "";

	switch (method) {
		// ------------------------------------------------------------------
		// Fetch.enable — register patterns and activate interception
		// ------------------------------------------------------------------
		case "Fetch.enable": {
			const p = params as {
				patterns?: Array<{
					urlPattern?: string;
					resourceType?: string;
					requestStage?: "Request" | "Response";
				}>;
				handleAuthRequests?: boolean;
			};

			const existing = net.fetchSessions.get(sid);
			const state: FetchInterceptionState = {
				enabled: true,
				patterns: (p.patterns ?? []).map((pat) => ({
					urlPattern: pat.urlPattern,
					resourceType: pat.resourceType,
					requestStage: pat.requestStage ?? "Request",
				})),
				pendingRequests: existing?.pendingRequests ?? new Map(),
			};

			// If no patterns provided, intercept everything
			if (state.patterns.length === 0) {
				state.patterns = [{ urlPattern: "*" }];
			}

			net.fetchSessions.set(sid, state);
			return {};
		}

		// ------------------------------------------------------------------
		// Fetch.disable — deactivate interception for this session
		// ------------------------------------------------------------------
		case "Fetch.disable": {
			const existing = net.fetchSessions.get(sid);
			if (existing) {
				existing.enabled = false;
				// Resolve any pending requests with "continue" so they don't hang
				for (const [, req] of existing.pendingRequests) {
					req.resolve({ type: "continue" });
				}
				existing.pendingRequests.clear();
			}
			return {};
		}

		// ------------------------------------------------------------------
		// Fetch.continueRequest — resume the paused request
		// ------------------------------------------------------------------
		case "Fetch.continueRequest": {
			const p = params as {
				requestId: string;
				url?: string;
				method?: string;
				postData?: string;
				headers?: Array<{ name: string; value: string }>;
				interceptResponse?: boolean;
			};

			const paused = findPendingRequest(net.fetchSessions, p.requestId);
			if (!paused) {
				// Not found — no-op (agent-browser may call this after session close)
				return {};
			}

			// Convert header array to Record if provided
			let headers: Record<string, string> | undefined;
			if (p.headers) {
				headers = {};
				for (const { name, value } of p.headers) {
					headers[name.toLowerCase()] = value;
				}
			}

			const action: FetchAction = {
				type: "continue",
				url: p.url,
				method: p.method,
				postData: p.postData,
				headers,
			};
			paused.resolve(action);
			return {};
		}

		// ------------------------------------------------------------------
		// Fetch.failRequest — abort the paused request with an error
		// ------------------------------------------------------------------
		case "Fetch.failRequest": {
			const p = params as { requestId: string; errorReason: string };

			const paused = findPendingRequest(net.fetchSessions, p.requestId);
			if (!paused) return {};

			paused.resolve({ type: "fail", errorReason: p.errorReason });
			return {};
		}

		// ------------------------------------------------------------------
		// Fetch.fulfillRequest — respond with a mock response
		// ------------------------------------------------------------------
		case "Fetch.fulfillRequest": {
			const p = params as {
				requestId: string;
				responseCode: number;
				responseHeaders?: Array<{ name: string; value: string }>;
				binaryResponseHeaders?: string;
				body?: string;
				responsePhrase?: string;
			};

			const paused = findPendingRequest(net.fetchSessions, p.requestId);
			if (!paused) return {};

			const action: FetchAction = {
				type: "fulfill",
				responseCode: p.responseCode,
				responseHeaders: p.responseHeaders ?? [],
				body: p.body,
			};
			paused.resolve(action);
			return {};
		}

		// ------------------------------------------------------------------
		// Fetch.continueWithAuth — supply credentials for an auth challenge
		// ------------------------------------------------------------------
		case "Fetch.continueWithAuth": {
			const p = params as {
				requestId: string;
				authChallengeResponse: {
					response: string;
					username?: string;
					password?: string;
				};
			};

			const paused = findPendingRequest(net.fetchSessions, p.requestId);
			if (!paused) return {};

			const action: FetchAction = {
				type: "auth",
				authChallengeResponse: p.authChallengeResponse,
			};
			paused.resolve(action);
			return {};
		}

		default:
			return null;
	}
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Searches all fetch sessions for a pending request with the given requestId.
 * Returns the PausedRequest if found, or undefined.
 */
function findPendingRequest(
	fetchSessions: Map<string, FetchInterceptionState>,
	requestId: string,
) {
	for (const state of fetchSessions.values()) {
		const req = state.pendingRequests.get(requestId);
		if (req) return req;
	}
	return undefined;
}
