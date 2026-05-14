/**
 * Audits domain handler.
 *
 * Stubs out Audits.enable which is sent by Puppeteer on startup.
 */

import type { DomainHandler } from "../types.js";

export const AuditsHandler: DomainHandler = async (method, _params, _ctx, _sessionId) => {
	switch (method) {
		case "Audits.enable":
			return {};

		default:
			return null;
	}
};
