/**
 * Input domain handler.
 *
 * Implements the four Input.* methods required by agent-browser:
 *   - Input.dispatchKeyEvent
 *   - Input.dispatchMouseEvent
 *   - Input.dispatchTouchEvent
 *   - Input.insertText
 *
 * Profile behaviour:
 *
 *   static profile — StaticDomTransport has no JS engine and no input layer.
 *     All four methods reject with CDPError -32601 explaining that
 *     fast/stealth/max must be used for keyboard or mouse input.
 *
 *   fast / stealth / max profiles — The SocketPairTransport (or equivalent
 *     proxy bridge) forwards every CDP frame directly to the backend (Lightpanda
 *     subprocess, patchright, Camoufox) before the in-process dispatcher is
 *     reached.  Returning null here tells the dispatcher chain that this
 *     handler does not handle the method, so the proxy layer handles it.
 *     In practice the handler is never invoked for these profiles at runtime.
 *
 *   http profile — Uses ImpersonatedClient (curl-impersonate), has no JS
 *     engine.  Rejects with CDPError -32601 "no JS in http".
 *     Defensive: the current CLI does not route http through StaticDomTransport
 *     so this branch is only reachable via direct unit-test dispatch.
 *
 * The handler is registered in StaticDomTransport's domain handler chain.
 * At runtime it is only ever called for the static profile.  The per-profile
 * factory `createInputHandler` is provided so unit tests can exercise each
 * profile branch in isolation without requiring a live transport.
 */

import { CDPError } from "../../transport/InProcessTransport.js";
import type { DomainHandler } from "../types.js";

// ---------------------------------------------------------------------------
// Supported Input methods
// ---------------------------------------------------------------------------

const INPUT_METHODS = new Set([
	"Input.dispatchKeyEvent",
	"Input.dispatchMouseEvent",
	"Input.dispatchTouchEvent",
	"Input.insertText",
] as const);

type InputMethodName = typeof INPUT_METHODS extends Set<infer T> ? T : never;

// ---------------------------------------------------------------------------
// Profile type
// ---------------------------------------------------------------------------

/** Known Bunlight profile identifiers. */
export type BunlightProfile = "static" | "fast" | "stealth" | "max" | "http";

// ---------------------------------------------------------------------------
// Error factories
// ---------------------------------------------------------------------------

/** Extracts the leaf name from "Domain.methodName" -> "methodName". */
function methodLeaf(fullMethod: string): string {
	const dot = fullMethod.indexOf(".");
	return dot === -1 ? fullMethod : fullMethod.slice(dot + 1);
}

function buildStaticError(method: string): CDPError {
	return new CDPError(
		`Input.${methodLeaf(method)} is not available in static profile ` +
			`(no JS engine, no input layer). ` +
			`Use --profile fast, stealth, or max for keyboard and mouse input.`,
		-32601,
	);
}

function buildHttpError(method: string): CDPError {
	return new CDPError(
		`Input.${methodLeaf(method)} is not available: no JS in http profile ` +
			`(curl-impersonate has no JS engine). ` +
			`Use --profile fast, stealth, or max for input events.`,
		-32601,
	);
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

/**
 * Creates an `InputHandler` bound to the given profile.
 *
 * - `"static"`: all four methods reject with a CDPError explaining that
 *   no JS engine is available in the static DOM-only profile.
 * - `"http"`: all four methods reject with a CDPError "no JS in http".
 * - `"fast"` / `"stealth"` / `"max"`: returns `null` for all Input.* methods
 *   so the caller (transport proxy or dispatcher) handles forwarding.
 *
 * @example
 * // In StaticDomTransport (the only runtime usage):
 * const InputHandler = createInputHandler("static");
 *
 * // In tests for http profile:
 * const httpHandler = createInputHandler("http");
 * await expect(httpHandler("Input.dispatchKeyEvent", {}, mockCtx, undefined))
 *   .rejects.toThrow("no JS in http");
 */
export function createInputHandler(profile: BunlightProfile): DomainHandler {
	return async (method, _params, _ctx, _sessionId) => {
		if (!INPUT_METHODS.has(method as InputMethodName)) {
			return null;
		}

		switch (profile) {
			case "static":
				throw buildStaticError(method);

			case "http":
				throw buildHttpError(method);

			case "fast":
			case "stealth":
			case "max":
				// The SocketPairTransport proxy intercepts CDP frames before the
				// in-process dispatcher is reached, so this path is never hit at
				// runtime.  Returning null here is correct: it signals that this
				// handler does not own the method and the transport-level forward
				// has already taken place.
				return null;

			default: {
				// Exhaustive check: TypeScript will error if BunlightProfile grows
				// without a corresponding case here.
				const _exhaustive: never = profile;
				void _exhaustive;
				throw buildStaticError(method);
			}
		}
	};
}

// ---------------------------------------------------------------------------
// Default export — static profile (registered in StaticDomTransport)
// ---------------------------------------------------------------------------

/**
 * The InputHandler instance registered in `StaticDomTransport`'s domain
 * handler chain.  Bound to the `"static"` profile: all four Input.* methods
 * reject with CDPError -32601 because the static DOM-only transport has no
 * JS engine and therefore no input dispatch layer.
 */
export const InputHandler: DomainHandler = createInputHandler("static");
