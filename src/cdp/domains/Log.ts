/**
 * Log domain handler.
 *
 * Stubs out Log.enable which is sent by Puppeteer on startup.
 * Full console-message forwarding is deferred to Phase 1.
 */

import type { DomainHandler } from "../types.js";

export const LogHandler: DomainHandler = async (method, _params, _ctx, _sessionId) => {
	switch (method) {
		case "Log.enable":
			return {};

		default:
			return null;
	}
};
