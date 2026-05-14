/**
 * Runtime domain handler.
 *
 * Handles: Runtime.enable, Runtime.evaluate, Runtime.callFunctionOn,
 *          Runtime.runIfWaitingForDebugger, Runtime.getProperties,
 *          Runtime.addBinding
 *
 * Events (emitted by other transports; static mode never fires them):
 *   Runtime.consoleAPICalled  — forwarded from fast/stealth/max profiles
 *   Runtime.exceptionThrown   — forwarded from fast/stealth/max profiles
 */

import type { DispatchContext, DomainHandler, PageState } from "../types.js";

// ---------------------------------------------------------------------------
// Binding registry (module-scoped)
// ---------------------------------------------------------------------------

/** Names registered via Runtime.addBinding. */
const registeredBindings = new Set<string>();

/** Returns all currently registered binding names (for inspection/tests). */
export function getRegisteredBindings(): ReadonlySet<string> {
	return registeredBindings;
}

// ---------------------------------------------------------------------------
// Event helper — used by fast/stealth/max profiles to forward runtime events
// ---------------------------------------------------------------------------

/** Emits Runtime.consoleAPICalled to a specific page session. */
export function emitConsoleAPICalled(
	ctx: DispatchContext,
	sessionId: string,
	opts: {
		type: string;
		args: Array<{ type: string; value?: unknown }>;
		executionContextId: number;
		timestamp: number;
		stackTrace?: unknown;
	},
): void {
	ctx.emitEvent({
		method: "Runtime.consoleAPICalled",
		sessionId,
		params: {
			type: opts.type,
			args: opts.args,
			executionContextId: opts.executionContextId,
			timestamp: opts.timestamp,
			stackTrace: opts.stackTrace ?? undefined,
		},
	});
}

/** Emits Runtime.exceptionThrown to a specific page session. */
export function emitExceptionThrown(
	ctx: DispatchContext,
	sessionId: string,
	opts: {
		timestamp: number;
		exceptionDetails: {
			exceptionId: number;
			text: string;
			lineNumber: number;
			columnNumber: number;
			exception?: { type: string; description?: string };
		};
	},
): void {
	ctx.emitEvent({
		method: "Runtime.exceptionThrown",
		sessionId,
		params: {
			timestamp: opts.timestamp,
			exceptionDetails: opts.exceptionDetails,
		},
	});
}

export const RuntimeHandler: DomainHandler = async (method, params, ctx, sessionId) => {
	switch (method) {
		case "Runtime.enable": {
			// Emit executionContextCreated for this page session so Puppeteer can
			// evaluate expressions.  We need both the default context (main world)
			// and the utility/isolated world.
			const rePage = sessionId ? ctx.pageBySessionSoft(sessionId) : null;
			if (rePage) {
				ctx.emitExecutionContexts(rePage);
			}
			return {};
		}

		case "Runtime.runIfWaitingForDebugger":
			return {};

		case "Runtime.evaluate": {
			const { expression } = params as { expression: string };
			const page = ctx.pageBySession(sessionId);
			return evalExpression(expression, page);
		}

		case "Runtime.callFunctionOn": {
			const {
				functionDeclaration,
				objectId,
				arguments: args,
			} = params as {
				functionDeclaration: string;
				objectId?: string;
				arguments?: Array<{ value?: unknown }>;
			};
			const page = ctx.pageBySession(sessionId);
			return callFunctionOn(functionDeclaration, objectId, args, page);
		}

		case "Runtime.getProperties": {
			// Minimal implementation for objectId resolution
			return { result: [], exceptionDetails: undefined };
		}

		case "Runtime.addBinding": {
			// Register a binding name so Puppeteer can inject callbacks.
			// In static mode there is no JS engine, so the binding is stored
			// but never actually called from page context.
			const { name } = params as { name: string };
			registeredBindings.add(name);
			return {};
		}

		default:
			return null;
	}
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function evalExpression(
	expression: string,
	page: PageState,
): { result: { type: string; value?: unknown; description?: string } } {
	const trimmed = expression
		.trim()
		.replace(/\n.*sourceURL=.*$/m, "")
		.trim();

	// Well-known expressions
	if (trimmed === "document.title") {
		return { result: { type: "string", value: page.title } };
	}
	if (trimmed === "location.href" || trimmed === "window.location.href") {
		return { result: { type: "string", value: page.url } };
	}
	if (trimmed === "document.documentElement.outerHTML") {
		return { result: { type: "string", value: page.doc?.rawHtml ?? "" } };
	}
	// For anything else return undefined — callers should use callFunctionOn
	return {
		result: {
			type: "undefined",
			description: "StaticDomTransport: expression not evaluated (no JS engine)",
		},
	};
}

function callFunctionOn(
	functionDeclaration: string,
	objectId: string | undefined,
	args: Array<{ value?: unknown }> | undefined,
	page: PageState,
): { result: { type: string; value?: unknown } } {
	void objectId;
	void args;

	// Strip Puppeteer internal source URL comments for cleaner matching
	const fn = functionDeclaration.replace(/\n.*sourceURL=.*$/m, "").trim();

	// document.title
	if (fn.includes("document.title") && !fn.includes("document.title=")) {
		return { result: { type: "string", value: page.title } };
	}
	// outerHTML / page content
	if (fn.includes("outerHTML")) {
		return { result: { type: "string", value: page.doc?.rawHtml ?? "" } };
	}
	// location.href / window.location
	if (fn.includes("location.href") || fn.includes("window.location")) {
		return { result: { type: "string", value: page.url } };
	}
	// addPageBinding / CDP_BINDING_PREFIX — Puppeteer bindings setup
	if (fn.includes("addPageBinding") || fn.includes("__puppeteer")) {
		return { result: { type: "undefined" } };
	}
	// Default: return undefined (no JS engine in static mode)
	return { result: { type: "undefined" } };
}
