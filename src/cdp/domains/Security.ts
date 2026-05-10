/**
 * Security domain handler.
 *
 * Implements certificate error suppression by storing the flag on the
 * per-page `SecurityState`.  `StaticDomTransport.#navigate` reads
 * `page.security.ignoreCertificateErrors` and sets
 * `tls: { rejectUnauthorized: false }` on Bun's fetch when the flag is true.
 */

import type { DomainHandler } from "../types.js";

export const SecurityHandler: DomainHandler = async (method, params, ctx, sessionId) => {
	switch (method) {
		// -----------------------------------------------------------------------
		// setIgnoreCertificateErrors — propagate to next fetch as TLS override
		// -----------------------------------------------------------------------
		case "Security.setIgnoreCertificateErrors": {
			const page = ctx.pageBySession(sessionId);
			const p = params as { ignore?: boolean };
			page.security.ignoreCertificateErrors = typeof p.ignore === "boolean" ? p.ignore : false;
			return {};
		}

		default:
			return null;
	}
};
