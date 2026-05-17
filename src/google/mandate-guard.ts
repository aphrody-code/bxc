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
 * @module bxc/google/mandate-guard
 * 
 * Programmatic enforcement of the "Strict Google-only Testing" mandate.
 * Prevents Bxc from making requests to non-Google domains.
 */

import { isGoogleDomain, isGoogleInfrastructure } from "./dns.ts";

export class MandateViolationError extends Error {
	constructor(hostname: string) {
		super(`Mandate Violation: Access to non-Google domain "${hostname}" is FORBIDDEN by GEMINI.md.`);
		this.name = "MandateViolationError";
	}
}

/**
 * Validates that a URL is compliant with the project mandate.
 */
export async function enforceMandate(url: string | URL): Promise<void> {
	const u = typeof url === "string" ? new URL(url) : url;
	const hostname = u.hostname;

	// 1. Fast check: Known Google domains
	if (isGoogleDomain(hostname)) return;

	// 2. Slow check: Infrastructure check (NS/MX/ASN)
	if (await isGoogleInfrastructure(hostname)) return;

	// 3. Special case: localhost for mock testing
	if (hostname === "localhost" || hostname === "127.0.0.1") {
		if (process.env.OBSCURA_ALLOW_PRIVATE_NETWORK === "1") return;
	}

	throw new MandateViolationError(hostname);
}
