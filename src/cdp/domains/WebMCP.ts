/**
 * WebMCP domain handler.
 *
 * Non-standard extension domain used by agent-browser / Puppeteer forks that
 * expose the Model Context Protocol over CDP.
 *
 * Stubs out WebMCP.enable so the connection handshake succeeds.
 */

import type { DomainHandler } from "../types.js";

export const WebMCPHandler: DomainHandler = async (method, _params, _ctx, _sessionId) => {
	switch (method) {
		case "WebMCP.enable":
			return {};

		default:
			return null;
	}
};
