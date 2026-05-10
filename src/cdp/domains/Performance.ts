/**
 * Performance domain handler.
 *
 * Stubs out Performance.enable which is sent by Puppeteer on startup.
 * Full metrics collection is deferred to Phase 1.
 */

import type { DomainHandler } from "../types.js";

export const PerformanceHandler: DomainHandler = async (method, _params, _ctx, _sessionId) => {
	switch (method) {
		case "Performance.enable":
			return {};

		default:
			return null;
	}
};
