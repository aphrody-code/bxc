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
 * @module bxc/utils/network-auditor
 * 
 * Real-time network auditing: DNS records, IPs, and CDN identification.
 */

import { dns } from "bun";

export interface NetworkAuditResult {
	hostname: string;
	ips: string[];
	cname: string | null;
	cdn?: string;
	server?: string;
	latencyMs?: number;
}

/**
 * Perform a real-time audit of a given hostname.
 */
export async function auditNetwork(hostname: string): Promise<NetworkAuditResult> {
	const t0 = Bun.nanoseconds();
	
	let ips: string[] = [];
	let cname: string | null = null;
	
	try {
		// Bun's native DNS resolution
		const addrs = await dns.lookup(hostname);
		if (addrs && addrs.length > 0) {
			ips = addrs.map(a => a.address);
		}
		
		// Note: Bun native dns currently lacks a high-level resolve('CNAME')
		// We'll use dig for CNAME if needed or skip for now to stay native.
	} catch {
		// console.error(`DNS Audit failed for ${hostname}:`, e);
	}

	const elapsed = (Bun.nanoseconds() - t0) / 1e6;

	const result: NetworkAuditResult = {
		hostname,
		ips,
		cname,
		latencyMs: Math.round(elapsed),
	};

	// Guess CDN from CNAME
	if (cname) {
		const c = (cname as string).toLowerCase();
		if (c.includes("cloudfront")) result.cdn = "Amazon CloudFront";
		else if (c.includes("akamai")) result.cdn = "Akamai";
		else if (c.includes("fastly")) result.cdn = "Fastly";
		else if (c.includes("cloudflare")) result.cdn = "Cloudflare";
		else if (c.includes("google")) result.cdn = "Google Global Cache / GGC";
		else if (c.includes("edgecast")) result.cdn = "EdgeCast";
		else if (c.includes("sucuri")) result.cdn = "Sucuri";
	}

	return result;
}

/**
 * Identify CDN/Server from response headers.
 */
export function identifyInfraFromHeaders(headers: Record<string, string>): { cdn?: string, server?: string } {
	const out: { cdn?: string, server?: string } = {};
	
	const server = headers["server"];
	if (server) out.server = server;

	const via = headers["via"];
	const cfRay = headers["cf-ray"];
	const xCache = headers["x-cache"];
	const xCdn = headers["x-cdn"];

	if (cfRay || server?.toLowerCase().includes("cloudflare")) out.cdn = "Cloudflare";
	else if (via?.toLowerCase().includes("cloudfront") || headers["x-amz-cf-id"]) out.cdn = "Amazon CloudFront";
	else if (xCache?.toLowerCase().includes("fastly") || headers["x-fastly-request-id"]) out.cdn = "Fastly";
	else if (server?.toLowerCase().includes("gws") || server?.toLowerCase().includes("ghs")) out.cdn = "Google Front End (GFE)";
	else if (xCdn) out.cdn = xCdn;

	return out;
}
