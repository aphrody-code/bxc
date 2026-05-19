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
 * Unified fetch wrapper for Bxc.
 */
export interface FetchOptions {
	insecure?: boolean;
	timeoutMs?: number;
	method?: string;
	body?: any;
	headers?: any;
	redirect?: "follow" | "error" | "manual";
	userAgent?: string;
}

export async function bxcFetch(url: string, opts: FetchOptions = {}): Promise<Response> {
	const fetchOpts: any = {
		method: opts.method ?? "GET",
		headers: {
			"User-Agent":
				opts.userAgent ??
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			...opts.headers,
		},
		redirect: opts.redirect ?? "follow",
	};

	if (opts.insecure || Bun.env.BXC_INSECURE === "1") {
		fetchOpts.tls = { rejectUnauthorized: false };
	}

	if (opts.timeoutMs) {
		fetchOpts.signal = AbortSignal.timeout(opts.timeoutMs);
	}

	if (opts.body) {
		fetchOpts.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
		if (typeof opts.body !== "string" && !fetchOpts.headers["Content-Type"]) {
			fetchOpts.headers["Content-Type"] = "application/json";
		}
	}

	return fetch(url, fetchOpts);
}
