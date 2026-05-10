/**
 * Target domain handler.
 *
 * Handles: Target.getBrowserContexts, Target.setDiscoverTargets,
 *          Target.setAutoAttach, Target.createTarget, Target.closeTarget,
 *          Target.getTargetInfo, Target.attachToTarget,
 *          Target.createBrowserContext, Target.getTargets,
 *          Target.detachFromTarget
 *
 * Events emitted:
 *   Target.detachedFromTarget  — on detach/close
 *   Target.targetInfoChanged   — when URL changes (Page.frameNavigated)
 */

import { CDPError } from "../../transport/InProcessTransport.js";
import type { DomainHandler } from "../types.js";

const BROWSER_CONTEXT_ID = "defaultBrowserContextId";
const BROWSER_TARGET_ID = "browserTargetId";
const BROWSER_SESSION_ID = "browserTargetSessionId";

/** Registry of synthetic browser context IDs created via createBrowserContext. */
const browserContextIds = new Set<string>([BROWSER_CONTEXT_ID]);
let browserContextCounter = 0;

export const TargetHandler: DomainHandler = async (method, params, ctx, sessionId) => {
	switch (method) {
		case "Target.getBrowserContexts":
			return { browserContextIds: [BROWSER_CONTEXT_ID] };

		case "Target.setDiscoverTargets": {
			// Emit existing pages then ACK
			for (const page of ctx.pages.values()) {
				ctx.emitEvent({
					method: "Target.targetCreated",
					params: { targetInfo: ctx.pageTargetInfo(page) },
				});
			}
			return {};
		}

		case "Target.setAutoAttach": {
			// Register this session as auto-attaching so future createTarget calls
			// know to emit Target.attachedToTarget automatically.
			ctx.autoAttachSessions.add(sessionId ?? "");

			if (!sessionId) {
				// Root connection level: announce the browser target so Puppeteer's
				// TargetManager can establish a session for it.
				ctx.emitEvent({
					method: "Target.attachedToTarget",
					params: {
						targetInfo: {
							targetId: BROWSER_TARGET_ID,
							type: "browser",
							title: "Bunlight Browser",
							url: "about:blank",
							attached: true,
							canAccessOpener: false,
							browserContextId: BROWSER_CONTEXT_ID,
						},
						sessionId: BROWSER_SESSION_ID,
						waitingForDebugger: false,
					},
				});
			} else {
				// Session level: auto-attach any page targets whose session differs
				// from the caller's session (avoid self-attachment loops).
				for (const page of ctx.pages.values()) {
					if (page.sessionId === sessionId) continue;
					ctx.emitEvent({
						method: "Target.attachedToTarget",
						sessionId,
						params: {
							targetInfo: ctx.pageTargetInfo(page),
							sessionId: page.sessionId,
							waitingForDebugger: false,
						},
					});
				}
			}
			return {};
		}

		case "Target.createTarget": {
			const page = ctx.createPage();
			// Announce the new target to all listeners (fires Target.targetCreated
			// on the root connection — TargetManager records it but doesn't attach yet).
			ctx.emitEvent({
				method: "Target.targetCreated",
				params: { targetInfo: ctx.pageTargetInfo(page) },
			});
			// Auto-attach: emit Target.attachedToTarget through every session that
			// registered setAutoAttach.  We prefer the browser-session path because
			// that's how Puppeteer's TargetManager expects the attachment hierarchy
			// (root → browser-session → page-session).
			// Do NOT emit on the root (empty sessionId) to avoid duplicate processing
			// by the TargetManager.
			const nonRootSessions = [...ctx.autoAttachSessions].filter((s) => s !== "");
			const emitSessions =
				nonRootSessions.length > 0 ? nonRootSessions : [...ctx.autoAttachSessions];
			for (const attachingSession of emitSessions) {
				ctx.emitEvent({
					method: "Target.attachedToTarget",
					// outer sessionId = which CDPSession receives this event
					sessionId: attachingSession || undefined,
					params: {
						targetInfo: ctx.pageTargetInfo(page),
						sessionId: page.sessionId,
						waitingForDebugger: false,
					},
				});
			}
			return { targetId: page.targetId };
		}

		case "Target.closeTarget": {
			const { targetId } = params as { targetId: string };
			const page = ctx.pages.get(targetId);
			if (!page) throw new CDPError(`Target not found: ${targetId}`, -32602);
			// Release any zigquery-backed document before forgetting the page.
			page.doc?.destroy();
			// We need to delete from the underlying mutable map — the DispatchContext
			// exposes a ReadonlyMap view so we cast to access the mutable backing map.
			(ctx.pages as Map<string, typeof page>).delete(targetId);
			ctx.emitEvent({
				method: "Target.targetDestroyed",
				params: { targetId },
			});
			return { success: true };
		}

		case "Target.getTargetInfo": {
			const { targetId } = params as { targetId?: string };
			if (!targetId) {
				// Return browser target info
				return {
					targetInfo: {
						targetId: BROWSER_TARGET_ID,
						type: "browser",
						title: "Bunlight Browser",
						url: "about:blank",
						attached: true,
						canAccessOpener: false,
						browserContextId: BROWSER_CONTEXT_ID,
					},
				};
			}
			const page = ctx.pages.get(targetId);
			if (!page) throw new CDPError(`Target not found: ${targetId}`, -32602);
			return { targetInfo: ctx.pageTargetInfo(page) };
		}

		case "Target.attachToTarget": {
			const { targetId } = params as { targetId: string };
			const page = ctx.pages.get(targetId);
			if (!page) {
				throw new CDPError(`Target not found: ${targetId}`, -32602);
			}
			return { sessionId: page.sessionId };
		}

		// -----------------------------------------------------------------
		// Phase 1 additions
		// -----------------------------------------------------------------

		case "Target.createBrowserContext": {
			// Return a new synthetic browser context ID.
			const contextId = `browserContext-${++browserContextCounter}`;
			browserContextIds.add(contextId);
			return { browserContextId: contextId };
		}

		case "Target.getTargets": {
			// Return all known page targets.
			const targetInfos = [...ctx.pages.values()].map((page) => ctx.pageTargetInfo(page));
			// Also include the browser target itself.
			targetInfos.unshift({
				targetId: BROWSER_TARGET_ID,
				type: "page" as const,
				title: "Bunlight Browser",
				url: "about:blank",
				attached: true,
				canAccessOpener: false,
				browserContextId: BROWSER_CONTEXT_ID,
			});
			return { targetInfos };
		}

		case "Target.detachFromTarget": {
			const { sessionId: detachSessionId, targetId } = params as {
				sessionId?: string;
				targetId?: string;
			};

			// Locate the page by sessionId or targetId.
			let foundSessionId: string | undefined;
			if (detachSessionId) {
				foundSessionId = detachSessionId;
			} else if (targetId) {
				const page = ctx.pages.get(targetId);
				foundSessionId = page?.sessionId;
			}

			if (foundSessionId) {
				ctx.emitEvent({
					method: "Target.detachedFromTarget",
					params: { sessionId: foundSessionId, targetId: targetId ?? "" },
				});
			}
			return {};
		}

		default:
			return null;
	}
};
