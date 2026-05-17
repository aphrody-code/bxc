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
