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
 * Page domain handler.
 *
 * Handles all Page.* methods used by agent-browser, with static-profile
 * semantics where a real rendering engine is not available.
 *
 * Methods handled:
 *   Working : Page.navigate, Page.getFrameTree
 *   Stub    : Page.enable, Page.setLifecycleEventsEnabled,
 *             Page.createIsolatedWorld, Page.setBypassCSP,
 *             Page.setCacheEnabled, Page.bringToFront,
 *             Page.resetNavigationHistory
 *   Phase 1 : Page.captureScreenshot, Page.printToPDF,
 *             Page.reload, Page.setDocumentContent,
 *             Page.startScreencast, Page.stopScreencast,
 *             Page.screencastFrameAck,
 *             Page.addScriptToEvaluateOnNewDocument (upgraded from stub),
 *             Page.removeScriptToEvaluateOnNewDocument
 *
 * Events emitted (appended to existing navigate events):
 *   Page.domContentEventFired, Page.loadEventFired,
 *   Page.javascriptDialogOpening (never in static mode),
 *   Page.javascriptDialogClosed  (never in static mode),
 *   Page.downloadWillBegin, Page.downloadProgress,
 *   Page.screencastFrame         (never in static mode)
 */

import type { DomainHandler } from "../types.js";
import { invalidateAXCache } from "./Accessibility.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Monotonic counter used to generate unique script identifiers. */
let _scriptIdCounter = 0;

function nextScriptId(): string {
	return `script-${(++_scriptIdCounter).toString(16)}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const PageHandler: DomainHandler = async (
	method,
	params,
	ctx,
	sessionId,
) => {
	switch (method) {
		// ------------------------------------------------------------------
		// No-op stubs
		// ------------------------------------------------------------------
		case "Page.enable":
		case "Page.setLifecycleEventsEnabled":
		case "Page.setBypassCSP":
		case "Page.setCacheEnabled":
		case "Page.bringToFront":
		case "Page.resetNavigationHistory":
			return {};

		// ------------------------------------------------------------------
		// Page.createIsolatedWorld
		// ------------------------------------------------------------------
		case "Page.createIsolatedWorld": {
			const { worldName } = params as { worldName?: string };
			const page = ctx.pageBySession(sessionId);
			if (worldName) {
				page.utilityWorldName = worldName;
			}
			// In static mode, isolated world ID is always loaderCounter * 2 + 2
			return { executionContextId: page.loaderCounter * 2 + 2 };
		}

		// ------------------------------------------------------------------
		// Page.addScriptToEvaluateOnNewDocument
		// Upgraded from stub: now tracks scripts per page and returns an
		// identifier that can be used to remove the script later.
		// In static mode the scripts are stored but never executed (no JS engine).
		// ------------------------------------------------------------------
		case "Page.addScriptToEvaluateOnNewDocument": {
			const { source, worldName } = params as {
				source: string;
				worldName?: string;
			};
			const page = ctx.pageBySession(sessionId);
			if (worldName) {
				page.utilityWorldName = worldName;
			}
			const identifier = nextScriptId();
			page.scripts.set(identifier, { identifier, source });
			return { identifier };
		}

		// ------------------------------------------------------------------
		// Page.removeScriptToEvaluateOnNewDocument (Phase 1 - new method)
		// ------------------------------------------------------------------
		case "Page.removeScriptToEvaluateOnNewDocument": {
			const { identifier } = params as { identifier: string };
			const page = ctx.pageBySession(sessionId);
			// Silently succeed even if identifier is unknown (agent-browser
			// may call remove on scripts from a prior session).
			page.scripts.delete(identifier);
			return {};
		}

		// ------------------------------------------------------------------
		// Page.getFrameTree
		// ------------------------------------------------------------------
		case "Page.getFrameTree": {
			const page = ctx.pageBySession(sessionId);
			const origin = computeOrigin(page.url);
			return {
				frameTree: {
					frame: {
						id: page.frameId,
						loaderId: page.loaderId,
						url: page.url,
						domainAndRegistry: "",
						securityOrigin: origin,
						mimeType: "text/html",
						adFrameStatus: { adFrameType: "none" },
						crossOriginIsolatedContextType: "none",
						gatedAPIFeatures: [],
					},
				},
			};
		}

		// ------------------------------------------------------------------
		// Page.navigate
		// ------------------------------------------------------------------
		case "Page.navigate": {
			const { url } = params as { url: string };
			const page = ctx.pageBySession(sessionId);
			// Invalidate the AX cache for this session before navigation so
			// the next Accessibility.getFullAXTree call rebuilds from fresh DOM.
			invalidateAXCache(page.sessionId);
			await ctx.navigate(page, url);

			// Increment the loader so LifecycleWatcher sees a new-document navigation.
			page.loaderId = `${page.frameId}-loader-${++page.loaderCounter}`;
			const loaderId = page.loaderId;
			const ts = Date.now() / 1000;

			// Emit Page.frameNavigated so FrameManager updates the frame URL.
			ctx.emitEvent({
				method: "Page.frameNavigated",
				sessionId: page.sessionId,
				params: {
					frame: {
						id: page.frameId,
						loaderId,
						url: page.url,
						domainAndRegistry: "",
						securityOrigin:
							url === "about:blank" || url.startsWith("data:")
								? "null"
								: computeOrigin(page.url),
						mimeType: "text/html",
						adFrameStatus: { adFrameType: "none" },
						crossOriginIsolatedContextType: "none",
						gatedAPIFeatures: [],
					},
					type: "Navigation",
				},
			});

			// "init" resets lifecycle + updates loaderId in the frame model.
			ctx.emitEvent({
				method: "Page.lifecycleEvent",
				sessionId: page.sessionId,
				params: {
					frameId: page.frameId,
					loaderId,
					name: "init",
					timestamp: ts,
				},
			});

			// Phase 1: emit domContentEventFired + loadEventFired after parse.
			ctx.emitEvent({
				method: "Page.domContentEventFired",
				sessionId: page.sessionId,
				params: { timestamp: ts },
			});
			ctx.emitEvent({
				method: "Page.lifecycleEvent",
				sessionId: page.sessionId,
				params: {
					frameId: page.frameId,
					loaderId,
					name: "DOMContentLoaded",
					timestamp: ts,
				},
			});

			// In static profile there are no sub-resources, so loadEventFired
			// fires immediately after domContentEventFired.
			ctx.emitEvent({
				method: "Page.loadEventFired",
				sessionId: page.sessionId,
				params: { timestamp: ts },
			});
			ctx.emitEvent({
				method: "Page.lifecycleEvent",
				sessionId: page.sessionId,
				params: {
					frameId: page.frameId,
					loaderId,
					name: "load",
					timestamp: ts,
				},
			});

			// Emit execution contexts so Puppeteer can bind evaluate calls.
			ctx.emitExecutionContexts(page);

			return { frameId: page.frameId, loaderId, status: page.lastStatus };
		}

		// ------------------------------------------------------------------
		// Page.reload (Phase 1 - new method)
		// Re-fetches the current URL and re-emits lifecycle events.
		// ------------------------------------------------------------------
		case "Page.reload": {
			const page = ctx.pageBySession(sessionId);
			// Invalidate AX cache so the reloaded DOM is seen fresh.
			invalidateAXCache(page.sessionId);
			const currentUrl = page.url;

			// Skip re-fetch for non-HTTP pages (about:blank, data: URIs).
			if (currentUrl !== "about:blank" && !currentUrl.startsWith("data:")) {
				await ctx.navigate(page, currentUrl);
			}

			page.loaderId = `${page.frameId}-loader-${++page.loaderCounter}`;
			const loaderId = page.loaderId;
			const ts = Date.now() / 1000;

			ctx.emitEvent({
				method: "Page.frameNavigated",
				sessionId: page.sessionId,
				params: {
					frame: {
						id: page.frameId,
						loaderId,
						url: page.url,
						domainAndRegistry: "",
						securityOrigin: computeOrigin(page.url),
						mimeType: "text/html",
						adFrameStatus: { adFrameType: "none" },
						crossOriginIsolatedContextType: "none",
						gatedAPIFeatures: [],
					},
					type: "Reload",
				},
			});

			ctx.emitEvent({
				method: "Page.lifecycleEvent",
				sessionId: page.sessionId,
				params: {
					frameId: page.frameId,
					loaderId,
					name: "init",
					timestamp: ts,
				},
			});
			ctx.emitEvent({
				method: "Page.domContentEventFired",
				sessionId: page.sessionId,
				params: { timestamp: ts },
			});
			ctx.emitEvent({
				method: "Page.lifecycleEvent",
				sessionId: page.sessionId,
				params: {
					frameId: page.frameId,
					loaderId,
					name: "DOMContentLoaded",
					timestamp: ts,
				},
			});
			ctx.emitEvent({
				method: "Page.loadEventFired",
				sessionId: page.sessionId,
				params: { timestamp: ts },
			});
			ctx.emitEvent({
				method: "Page.lifecycleEvent",
				sessionId: page.sessionId,
				params: {
					frameId: page.frameId,
					loaderId,
					name: "load",
					timestamp: ts,
				},
			});

			ctx.emitExecutionContexts(page);
			return {};
		}

		// ------------------------------------------------------------------
		// Page.setDocumentContent (Phase 1 - new method)
		// Replaces the page's document with the provided HTML string.
		// The page URL is preserved; the doc is re-parsed via zigquery.
		// ------------------------------------------------------------------
		case "Page.setDocumentContent": {
			const { frameId, html } = params as { frameId?: string; html: string };
			const page = ctx.pageBySession(sessionId);
			// Invalidate AX cache — document content is being replaced.
			invalidateAXCache(page.sessionId);

			// Allow frameId mismatch to silently succeed (agent-browser sends
			// the frameId it knows about; in static mode there is always exactly
			// one frame per page).
			void frameId;

			const previousUrl = page.url;

			// Use the navigate path with a data: URI so zigquery re-parses the
			// HTML correctly, then restore the original URL so the frame model
			// is not disrupted.
			await ctx.navigate(page, `data:text/html,${encodeURIComponent(html)}`);
			page.url = previousUrl;

			page.loaderId = `${page.frameId}-loader-${++page.loaderCounter}`;
			const loaderId = page.loaderId;
			const ts = Date.now() / 1000;

			ctx.emitEvent({
				method: "Page.domContentEventFired",
				sessionId: page.sessionId,
				params: { timestamp: ts },
			});
			ctx.emitEvent({
				method: "Page.lifecycleEvent",
				sessionId: page.sessionId,
				params: {
					frameId: page.frameId,
					loaderId,
					name: "DOMContentLoaded",
					timestamp: ts,
				},
			});
			ctx.emitEvent({
				method: "Page.loadEventFired",
				sessionId: page.sessionId,
				params: { timestamp: ts },
			});
			ctx.emitEvent({
				method: "Page.lifecycleEvent",
				sessionId: page.sessionId,
				params: {
					frameId: page.frameId,
					loaderId,
					name: "load",
					timestamp: ts,
				},
			});

			ctx.emitExecutionContexts(page);
			return {};
		}

		// ------------------------------------------------------------------
		// Page.captureScreenshot (Phase 1 - new method)
		// Static profile has no rendering engine, so we return a CDPError
		// directing the caller to use profile=fast/stealth/max.
		// The error code -32000 follows the Chrome convention for
		// "Server error" - a well-defined condition, not "method missing".
		// ------------------------------------------------------------------
		case "Page.captureScreenshot": {
			throw Object.assign(
				new Error(
					"Page.captureScreenshot is not supported in profile=static " +
						"(no rendering engine). Use profile=fast, stealth, or max instead.",
				),
				{ code: -32000 },
			);
		}

		// ------------------------------------------------------------------
		// Page.printToPDF (Phase 1 - new method)
		// Same constraint as captureScreenshot.
		// ------------------------------------------------------------------
		case "Page.printToPDF": {
			throw Object.assign(
				new Error(
					"Page.printToPDF is not supported in profile=static " +
						"(no rendering engine). Use profile=fast, stealth, or max instead.",
				),
				{ code: -32000 },
			);
		}

		// ------------------------------------------------------------------
		// Page.startScreencast (Phase 1 - new method)
		// Static profile cannot produce video frames.  Record the active state
		// so stopScreencast / screencastFrameAck have something to check.
		// ------------------------------------------------------------------
		case "Page.startScreencast": {
			const page = ctx.pageBySession(sessionId);
			page.screencastActive = true;
			// No frames will ever be emitted in static mode.
			// Page.screencastFrame events are only fired by real rendering backends.
			return {};
		}

		// ------------------------------------------------------------------
		// Page.stopScreencast (Phase 1 - new method)
		// ------------------------------------------------------------------
		case "Page.stopScreencast": {
			const page = ctx.pageBySession(sessionId);
			page.screencastActive = false;
			return {};
		}

		// ------------------------------------------------------------------
		// Page.screencastFrameAck (Phase 1 - new method)
		// Acknowledges receipt of a screencast frame.  In static mode there
		// are no frames, so this is always a no-op.
		// ------------------------------------------------------------------
		case "Page.screencastFrameAck": {
			// No-op: static mode never emits screencastFrame events.
			return {};
		}

		// ------------------------------------------------------------------
		// handleJavaScriptDialog
		// Accepts or dismisses a JS dialog.  In static mode JS dialogs are
		// never opened (no JS execution), so this is a no-op but must not
		// throw, as agent-browser may send it speculatively.
		// ------------------------------------------------------------------
		case "Page.handleJavaScriptDialog": {
			return {};
		}

		// ------------------------------------------------------------------
		// Page.getLayoutMetrics
		// Returns synthetic viewport / content metrics.  agent-browser uses
		// this to determine scroll boundaries before taking screenshots.
		// ------------------------------------------------------------------
		case "Page.getLayoutMetrics": {
			return {
				layoutViewport: {
					pageX: 0,
					pageY: 0,
					clientWidth: 1280,
					clientHeight: 720,
				},
				visualViewport: {
					offsetX: 0,
					offsetY: 0,
					pageX: 0,
					pageY: 0,
					clientWidth: 1280,
					clientHeight: 720,
					scale: 1,
					zoom: 1,
				},
				contentSize: {
					x: 0,
					y: 0,
					width: 1280,
					height: 720,
				},
				cssLayoutViewport: {
					pageX: 0,
					pageY: 0,
					clientWidth: 1280,
					clientHeight: 720,
				},
				cssVisualViewport: {
					offsetX: 0,
					offsetY: 0,
					pageX: 0,
					pageY: 0,
					clientWidth: 1280,
					clientHeight: 720,
					scale: 1,
					zoom: 1,
				},
				cssContentSize: {
					x: 0,
					y: 0,
					width: 1280,
					height: 720,
				},
			};
		}

		default:
			return null;
	}
};

// ---------------------------------------------------------------------------
// Event helpers (called from outside: navigate, download detection, etc.)
// ---------------------------------------------------------------------------

/**
 * Emits Page.downloadWillBegin on the given session when a navigation
 * response carries a Content-Disposition: attachment header.
 *
 * Call this from the navigate helper when a download is detected.
 */
export function emitDownloadWillBegin(
	ctx: import("../types.js").DispatchContext,
	page: import("../types.js").PageState,
	opts: { guid: string; url: string; suggestedFilename: string },
): void {
	ctx.emitEvent({
		method: "Page.downloadWillBegin",
		sessionId: page.sessionId,
		params: {
			frameId: page.frameId,
			guid: opts.guid,
			url: opts.url,
			suggestedFilename: opts.suggestedFilename,
		},
	});
}

/**
 * Emits Page.downloadProgress on the given session.
 * state: "inProgress" | "completed" | "canceled"
 */
export function emitDownloadProgress(
	ctx: import("../types.js").DispatchContext,
	page: import("../types.js").PageState,
	opts: {
		guid: string;
		totalBytes: number;
		receivedBytes: number;
		state: "inProgress" | "completed" | "canceled";
	},
): void {
	ctx.emitEvent({
		method: "Page.downloadProgress",
		sessionId: page.sessionId,
		params: {
			guid: opts.guid,
			totalBytes: opts.totalBytes,
			receivedBytes: opts.receivedBytes,
			state: opts.state,
		},
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeOrigin(url: string): string {
	if (url === "about:blank" || url.startsWith("data:")) return "null";
	try {
		return new URL(url).origin;
	} catch {
		return "null";
	}
}
