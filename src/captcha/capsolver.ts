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
 * @module bxc/captcha/capsolver
 *
 * CapSolver API wrapper — supports Turnstile, reCAPTCHA v2/v3, hCaptcha.
 *
 * Configuration via environment variable CAPSOLVER_API_KEY.
 * If the key is absent the wrapper enters MOCK mode and returns a predictable
 * token so integration tests can exercise the full code-path without spending
 * credits.
 *
 * Reference : https://docs.capsolver.com/guide/getting-started.html
 * Pricing   : Turnstile $0.80/1k (AntiTurnstileTaskProxyLess)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All task types supported by this wrapper. */
export type CapSolverTaskType =
	| "AntiTurnstileTaskProxyLess"
	| "ReCaptchaV2TaskProxyLess"
	| "ReCaptchaV2EnterpriseTaskProxyLess"
	| "ReCaptchaV3TaskProxyLess"
	| "HCaptchaTaskProxyLess";

/** Metadata about the website where the captcha lives. */
export interface CapSolverWebsite {
	/** Full URL of the page containing the captcha. */
	url: string;
	/** The site key (data-sitekey attribute or equivalent). */
	siteKey: string;
	/** Optional action for Turnstile / reCAPTCHA v3. */
	action?: string;
	/** Optional cdata for Turnstile (some enterprise widgets). */
	cData?: string;
}

/** Options for creating a task. */
export interface CapSolverTaskOptions {
	taskType: CapSolverTaskType;
	website: CapSolverWebsite;
	/**
	 * Override the API key for this request.
	 * Falls back to CAPSOLVER_API_KEY env var, then mock mode.
	 */
	apiKey?: string;
}

/** The result returned after a successful solve. */
export interface CapSolverResult {
	/** The captcha token ready to be submitted. */
	token: string;
	/** The task type that produced this result. */
	taskType: CapSolverTaskType;
	/** Elapsed time in milliseconds (includes polling overhead). */
	elapsedMs: number;
	/** Whether this result comes from mock mode (no real solve). */
	mocked: boolean;
}

// ---------------------------------------------------------------------------
// Internal API shapes (CapSolver REST)
// ---------------------------------------------------------------------------

interface CapSolverCreateTaskBody {
	clientKey: string;
	task: {
		type: CapSolverTaskType;
		websiteURL: string;
		websiteKey: string;
		metadata?: { action?: string; cdata?: string };
	};
}

interface CapSolverCreateTaskResponse {
	errorId: number;
	errorCode?: string;
	errorDescription?: string;
	taskId?: string;
}

interface CapSolverGetResultBody {
	clientKey: string;
	taskId: string;
}

interface CapSolverGetResultResponse {
	errorId: number;
	errorCode?: string;
	errorDescription?: string;
	status?: "idle" | "processing" | "ready";
	solution?: {
		token?: string;
		gRecaptchaResponse?: string;
		userResponse?: string;
	};
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAPSOLVER_BASE_URL = "https://api.capsolver.com";
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 40; // 2 minutes max

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

const MOCK_TOKEN_PREFIX = "MOCK_CAPSOLVER_TOKEN";

function generateMockToken(opts: CapSolverTaskOptions): CapSolverResult {
	const mockToken = `${MOCK_TOKEN_PREFIX}__${opts.taskType}__${opts.website.siteKey.slice(0, 8)}__${Date.now()}`;
	return {
		token: mockToken,
		taskType: opts.taskType,
		elapsedMs: 0,
		mocked: true,
	};
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function postJson<TReq, TRes>(url: string, body: TReq): Promise<TRes> {
	const resp = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!resp.ok) {
		throw new Error(`CapSolver HTTP ${resp.status}: ${await resp.text()}`);
	}
	return resp.json() as Promise<TRes>;
}

// ---------------------------------------------------------------------------
// Core solver
// ---------------------------------------------------------------------------

/**
 * Solves a captcha challenge via the CapSolver API.
 *
 * Automatically falls back to MOCK mode when CAPSOLVER_API_KEY is absent, so
 * tests can run without credentials.
 *
 * @example
 * ```ts
 * const result = await solve({
 *   taskType: "AntiTurnstileTaskProxyLess",
 *   website: { url: "https://demo.com", siteKey: "0x4AAAAAAA..." },
 * });
 * console.log(result.token); // submit to form
 * ```
 */
export async function solve(opts: CapSolverTaskOptions): Promise<CapSolverResult> {
	const apiKey = opts.apiKey ?? Bun.env.CAPSOLVER_API_KEY ?? "";

	if (!apiKey) {
		console.warn(
			"[capsolver] CAPSOLVER_API_KEY not set — running in MOCK mode. " +
				"Set the env var to enable real solving.",
		);
		return generateMockToken(opts);
	}

	const startMs = Date.now();

	// --- Step 1: create task ---
	const createBody: CapSolverCreateTaskBody = {
		clientKey: apiKey,
		task: {
			type: opts.taskType,
			websiteURL: opts.website.url,
			websiteKey: opts.website.siteKey,
			...(opts.website.action || opts.website.cData
				? {
						metadata: {
							...(opts.website.action ? { action: opts.website.action } : {}),
							...(opts.website.cData ? { cdata: opts.website.cData } : {}),
						},
					}
				: {}),
		},
	};

	const createResp = await postJson<CapSolverCreateTaskBody, CapSolverCreateTaskResponse>(
		`${CAPSOLVER_BASE_URL}/createTask`,
		createBody,
	);

	if (createResp.errorId !== 0 || !createResp.taskId) {
		throw new Error(
			`CapSolver createTask error ${createResp.errorCode ?? "UNKNOWN"}: ` +
				(createResp.errorDescription ?? "no description"),
		);
	}

	const taskId = createResp.taskId;

	// --- Step 2: poll for result ---
	const getBody: CapSolverGetResultBody = { clientKey: apiKey, taskId };

	for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
		await Bun.sleep(POLL_INTERVAL_MS);

		const result = await postJson<CapSolverGetResultBody, CapSolverGetResultResponse>(
			`${CAPSOLVER_BASE_URL}/getTaskResult`,
			getBody,
		);

		if (result.errorId !== 0) {
			throw new Error(
				`CapSolver getTaskResult error ${result.errorCode ?? "UNKNOWN"}: ` +
					(result.errorDescription ?? "no description"),
			);
		}

		if (result.status === "ready") {
			const rawToken =
				result.solution?.token ??
				result.solution?.gRecaptchaResponse ??
				result.solution?.userResponse;

			if (!rawToken) {
				throw new Error("CapSolver returned status=ready but solution token is missing");
			}

			return {
				token: rawToken,
				taskType: opts.taskType,
				elapsedMs: Date.now() - startMs,
				mocked: false,
			};
		}

		// status === "idle" | "processing" → keep polling
	}

	throw new Error(
		`CapSolver timed out after ${POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS}ms (taskId=${taskId})`,
	);
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/**
 * Solve a Cloudflare Turnstile challenge (AntiTurnstileTaskProxyLess).
 * This is the primary use-case in the `max` profile.
 *
 * Success rate: 85-90% per CapSolver docs.
 * Cost: $0.80/1k solves (as of 2026-05).
 */
export function solveTurnstile(
	websiteUrl: string,
	siteKey: string,
	opts?: { action?: string; cData?: string; apiKey?: string },
): Promise<CapSolverResult> {
	return solve({
		taskType: "AntiTurnstileTaskProxyLess",
		website: { url: websiteUrl, siteKey, action: opts?.action, cData: opts?.cData },
		apiKey: opts?.apiKey,
	});
}

/**
 * Solve a reCAPTCHA v2 challenge (ReCaptchaV2TaskProxyLess).
 */
export function solveRecaptchaV2(
	websiteUrl: string,
	siteKey: string,
	opts?: { apiKey?: string },
): Promise<CapSolverResult> {
	return solve({
		taskType: "ReCaptchaV2TaskProxyLess",
		website: { url: websiteUrl, siteKey },
		apiKey: opts?.apiKey,
	});
}

/**
 * Solve a reCAPTCHA v3 challenge (ReCaptchaV3TaskProxyLess).
 */
export function solveRecaptchaV3(
	websiteUrl: string,
	siteKey: string,
	action: string,
	opts?: { apiKey?: string },
): Promise<CapSolverResult> {
	return solve({
		taskType: "ReCaptchaV3TaskProxyLess",
		website: { url: websiteUrl, siteKey, action },
		apiKey: opts?.apiKey,
	});
}

/**
 * Solve an hCaptcha challenge (HCaptchaTaskProxyLess).
 */
export function solveHCaptcha(
	websiteUrl: string,
	siteKey: string,
	opts?: { apiKey?: string },
): Promise<CapSolverResult> {
	return solve({
		taskType: "HCaptchaTaskProxyLess",
		website: { url: websiteUrl, siteKey },
		apiKey: opts?.apiKey,
	});
}

// ---------------------------------------------------------------------------
// Balance check utility
// ---------------------------------------------------------------------------

/** Returns the remaining CapSolver account balance in USD. */
export async function getBalance(apiKey?: string): Promise<number> {
	const key = apiKey ?? Bun.env.CAPSOLVER_API_KEY ?? "";
	if (!key) return 0;

	const resp = await postJson<{ clientKey: string }, { balance?: number; errorId: number }>(
		`${CAPSOLVER_BASE_URL}/getBalance`,
		{ clientKey: key },
	);

	if (resp.errorId !== 0) return 0;
	return resp.balance ?? 0;
}
