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
 * @module bxc/detect-deep
 *
 * Multi-signal detection of frontend, backend, CDN, DNS, hosting, and
 * analytics technologies behind a URL.
 */

import { promises as nodeDns } from "node:dns";
import { detectFrameworks } from "./detect.ts";
import { bxcFetch } from "./utils/bxc-fetch.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DetectionBucket =
	| "frontend"
	| "backend"
	| "cdn"
	| "dns"
	| "hosting"
	| "analytics"
	| "language"
	| "server"
	| "cms"
	| "tag-manager"
	| "framework"
	| "library"
	| "other";

export interface DetectionEvidence {
	name: string;
	evidence: string;
	source: string;
	confidence?: number;
	version?: string;
	categories?: string[];
}

export interface DeepDetectionResult {
	url: string;
	finalUrl: string;
	httpStatus: number;
	hostname: string;
	resolvedIps: string[];
	cnameChain: string[];
	nsRecords: string[];
	reversePtr: Record<string, string[]>;
	frontend: DetectionEvidence[];
	backend: DetectionEvidence[];
	cdn: DetectionEvidence[];
	dns: DetectionEvidence[];
	hosting: DetectionEvidence[];
	server: DetectionEvidence[];
	language: DetectionEvidence[];
	cms: DetectionEvidence[];
	analytics: DetectionEvidence[];
	tagManagers: DetectionEvidence[];
	framework: DetectionEvidence[];
	library: DetectionEvidence[];
	other: DetectionEvidence[];
}

// ---------------------------------------------------------------------------
// IP range tables
// ---------------------------------------------------------------------------

const CDN_IP_PREFIXES: Array<{ name: string; prefixes: string[] }> = [
	{
		name: "Cloudflare",
		prefixes: [
			"103.21.244.",
			"103.22.200.",
			"103.31.4.",
			"104.16.",
			"104.17.",
			"104.18.",
			"104.19.",
			"104.20.",
			"104.21.",
			"104.22.",
			"104.23.",
			"104.24.",
			"104.25.",
			"104.26.",
			"104.27.",
			"108.162.192.",
			"131.0.72.",
			"141.101.64.",
			"162.158.",
			"172.64.",
			"172.65.",
			"172.66.",
			"172.67.",
			"172.68.",
			"172.69.",
			"172.70.",
			"173.245.48.",
			"188.114.",
			"190.93.240.",
			"197.234.240.",
			"198.41.128.",
		],
	},
	{
		name: "Fastly",
		prefixes: [
			"23.235.32.",
			"43.249.72.",
			"103.244.50.",
			"103.245.222.",
			"103.245.224.",
			"104.156.80.",
			"146.75.",
			"151.101.",
			"157.52.64.",
			"167.82.",
			"199.27.72.",
			"199.232.",
		],
	},
	{
		name: "AWS CloudFront",
		prefixes: [
			"13.32.",
			"13.33.",
			"13.224.",
			"13.225.",
			"13.249.",
			"18.160.",
			"18.161.",
			"18.164.",
			"18.165.",
			"18.172.",
			"18.173.",
			"52.84.",
			"52.85.",
			"54.182.",
			"54.192.",
			"54.230.",
			"54.239.",
			"99.84.",
			"99.86.",
			"108.156.",
			"108.157.",
			"108.158.",
		],
	},
	{ name: "Vercel", prefixes: ["76.76.21.", "76.76.19.", "64.252."] },
	{ name: "Netlify", prefixes: ["75.2.", "99.83.", "13.249.", "151.101."] },
	{
		name: "Akamai",
		prefixes: [
			"23.32.",
			"23.33.",
			"23.34.",
			"23.35.",
			"23.36.",
			"23.37.",
			"23.38.",
			"23.39.",
			"23.40.",
			"23.42.",
			"23.43.",
			"23.44.",
			"23.45.",
			"23.46.",
			"23.47.",
			"23.48.",
			"23.49.",
			"23.50.",
			"23.51.",
			"23.52.",
			"23.53.",
			"23.54.",
			"23.55.",
			"23.56.",
			"23.57.",
			"23.58.",
			"23.59.",
			"23.60.",
			"23.61.",
			"23.62.",
			"23.63.",
			"23.64.",
			"23.65.",
			"23.66.",
			"23.67.",
			"23.71.",
			"23.72.",
			"23.74.",
			"23.78.",
			"23.79.",
			"23.192.",
			"23.193.",
			"23.194.",
			"23.195.",
			"23.196.",
			"23.197.",
			"23.198.",
			"23.199.",
			"23.200.",
			"23.201.",
			"23.202.",
			"23.203.",
			"23.204.",
			"23.205.",
			"23.206.",
			"23.207.",
			"23.208.",
			"23.209.",
			"23.210.",
			"23.211.",
			"23.212.",
			"23.213.",
			"23.214.",
			"23.215.",
			"23.216.",
			"23.217.",
			"23.218.",
			"23.219.",
			"104.64.",
			"104.65.",
			"104.66.",
			"104.67.",
			"104.68.",
			"104.69.",
			"104.70.",
			"104.71.",
			"104.72.",
			"104.73.",
			"104.74.",
			"104.75.",
			"104.76.",
			"104.77.",
			"104.78.",
			"104.79.",
			"104.80.",
			"104.81.",
			"104.82.",
			"104.83.",
			"104.84.",
			"104.85.",
			"104.86.",
			"104.87.",
			"104.88.",
			"104.89.",
			"104.90.",
			"104.91.",
			"104.92.",
			"104.93.",
			"104.94.",
			"104.95.",
			"104.96.",
			"104.97.",
			"104.98.",
			"104.99.",
			"104.100.",
			"104.101.",
			"104.102.",
			"104.103.",
			"104.104.",
			"104.105.",
			"104.106.",
			"104.107.",
			"104.108.",
			"104.109.",
			"104.110.",
			"104.111.",
			"104.112.",
			"104.113.",
			"104.114.",
			"104.115.",
			"104.116.",
			"104.117.",
			"104.118.",
			"104.119.",
			"104.120.",
			"104.121.",
			"104.122.",
			"104.123.",
			"104.124.",
			"104.125.",
			"104.126.",
			"104.127.",
			"184.24.",
			"184.25.",
			"184.26.",
			"184.27.",
			"184.28.",
			"184.29.",
			"184.30.",
			"184.31.",
		],
	},
	{
		name: "Google Frontend",
		prefixes: [
			"34.96.",
			"34.97.",
			"34.98.",
			"34.107.",
			"35.190.",
			"35.191.",
			"35.235.",
			"35.241.",
			"108.177.",
			"142.250.",
			"172.217.",
			"216.58.",
			"216.239.",
		],
	},
	{
		name: "Azure Front Door",
		prefixes: ["13.107.21.", "13.107.42.", "13.107.213.", "20.36.", "40.90.", "40.93.", "40.95."],
	},
	{
		name: "Google Developers Pages",
		prefixes: ["185.199.108.", "185.199.109.", "185.199.110.", "185.199.111."],
	},
	{ name: "Heroku", prefixes: ["54.144.", "54.158.", "54.159.", "54.161.", "54.165.", "54.166."] },
];

function ipToCdn(ip: string): string | null {
	for (const { name, prefixes } of CDN_IP_PREFIXES) {
		for (const p of prefixes) {
			if (ip.startsWith(p)) return name;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// DNS providers
// ---------------------------------------------------------------------------

const NS_PATTERNS: Array<{ name: string; matches: RegExp }> = [
	{ name: "Cloudflare DNS", matches: /\.cloudflare\.com$|\.ns\.cloudflare\.com$/i },
	{ name: "AWS Route 53", matches: /\.awsdns-/i },
	{
		name: "Google Cloud DNS",
		matches: /\.googledomains\.com$|\.zdns\.google$|^ns\d?\.google\.com$/i,
	},
	{ name: "Azure DNS", matches: /\.azure-dns\.com$|\.azure-dns\.net$/i },
	{ name: "DigitalOcean", matches: /\.digitalocean\.com$/i },
	{ name: "DNSimple", matches: /\.dnsimple\.com$/i },
	{ name: "GoDaddy DNS", matches: /\.domaincontrol\.com$/i },
	{ name: "Namecheap", matches: /\.registrar-servers\.com$/i },
	{ name: "Vercel DNS", matches: /\.vercel-dns\.com$/i },
	{ name: "Netlify DNS", matches: /\.nsone\.net$|\.netlify\.com$/i },
	{ name: "Hover", matches: /\.hover\.com$/i },
	{ name: "Gandi", matches: /\.gandi\.net$/i },
	{ name: "OVH", matches: /\.ovh\.net$|\.ovh\.com$/i },
];

function nsToProvider(ns: string): string | null {
	for (const { name, matches } of NS_PATTERNS) {
		if (matches.test(ns)) return name;
	}
	return null;
}

const CNAME_HOSTING_PATTERNS: Array<{ name: string; bucket: DetectionBucket; matches: RegExp }> = [
	{ name: "Vercel", bucket: "hosting", matches: /\.vercel-dns\.com$|\.vercel\.app$|\.now\.sh$/i },
	{ name: "Netlify", bucket: "hosting", matches: /\.netlify\.com$|\.netlify\.app$/i },
	{ name: "Google Developers Pages", bucket: "hosting", matches: /\.github\.io$/i },
	{ name: "GitLab Pages", bucket: "hosting", matches: /\.gitlab\.io$/i },
	{ name: "Heroku", bucket: "hosting", matches: /\.herokuapp\.com$|\.herokudns\.com$/i },
	{ name: "Render", bucket: "hosting", matches: /\.onrender\.com$/i },
	{ name: "Fly.io", bucket: "hosting", matches: /\.fly\.dev$|\.fly\.io$/i },
	{ name: "Railway", bucket: "hosting", matches: /\.railway\.app$|\.up\.railway\.app$/i },
	{
		name: "Google Cloud Run",
		bucket: "hosting",
		matches: /\.appspot\.com$|\.run\.app$|\.googleapis\.com$/i,
	},
	{ name: "AWS S3", bucket: "hosting", matches: /\.s3\.amazonaws\.com$|\.s3-website/i },
	{ name: "AWS CloudFront", bucket: "cdn", matches: /\.cloudfront\.net$/i },
	{ name: "Cloudflare Pages", bucket: "hosting", matches: /\.pages\.dev$/i },
	{ name: "Shopify", bucket: "hosting", matches: /\.myshopify\.com$|shopify\.com$/i },
	{ name: "Webflow", bucket: "hosting", matches: /\.webflow\.io$|\.webflow\.com$/i },
];

function cnameToProvider(cname: string): { name: string; bucket: DetectionBucket } | null {
	for (const p of CNAME_HOSTING_PATTERNS) {
		if (p.matches.test(cname)) return { name: p.name, bucket: p.bucket };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Header fingerprints
// ---------------------------------------------------------------------------

const HEADER_FINGERPRINTS: Array<{
	name: string;
	bucket: DetectionBucket;
	header: string;
	match?: RegExp;
}> = [
	{ name: "Cloudflare", bucket: "cdn", header: "cf-ray" },
	{ name: "Cloudflare", bucket: "cdn", header: "cf-cache-status" },
	{ name: "AWS CloudFront", bucket: "cdn", header: "x-amz-cf-id" },
	{ name: "Fastly", bucket: "cdn", header: "x-served-by", match: /^cache-/i },
	{ name: "Akamai", bucket: "cdn", header: "x-akamai-edge" },
	{ name: "Vercel", bucket: "cdn", header: "x-vercel-id" },
	{ name: "Netlify", bucket: "cdn", header: "x-nf-request-id" },
	{ name: "nginx", bucket: "server", header: "server", match: /nginx/i },
	{ name: "Apache", bucket: "server", header: "server", match: /apache/i },
	{ name: "Caddy", bucket: "server", header: "server", match: /caddy/i },
	{ name: "Next.js", bucket: "backend", header: "x-powered-by", match: /next\.js/i },
	{ name: "PHP", bucket: "language", header: "x-powered-by", match: /php\//i },
	{ name: "Wordpress", bucket: "cms", header: "x-powered-by", match: /wp-engine|wordpress/i },
];

function fingerprintHeaders(headers: Record<string, string>): DetectionEvidence[] {
	const out: DetectionEvidence[] = [];
	for (const fp of HEADER_FINGERPRINTS) {
		const v = headers[fp.header.toLowerCase()];
		if (!v) continue;
		if (fp.match && !fp.match.test(v)) continue;
		out.push({
			name: fp.name,
			evidence: `${fp.header}: ${v.slice(0, 80)}`,
			source: "header",
			confidence: 0.95,
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// Body signatures
// ---------------------------------------------------------------------------

const BODY_SIGNATURES: Array<{
	name: string;
	bucket: DetectionBucket;
	pattern: RegExp;
	versionPattern?: RegExp;
}> = [
	{
		name: "Next.js",
		bucket: "frontend",
		pattern: /\/_next\/static\//,
		versionPattern: /Next\.js v(\d+\.\d+\.\d+)/,
	},
	{ name: "Nuxt.js", bucket: "frontend", pattern: /\/_nuxt\/|window\.__NUXT__/ },
	{ name: "Astro", bucket: "frontend", pattern: /<astro-island|astro-slot|data-astro-/ },
	{ name: "WordPress", bucket: "cms", pattern: /\/wp-content\/|\/wp-includes\// },
	{ name: "Shopify", bucket: "cms", pattern: /cdn\.shopify\.com|window\.Shopify/ },
	{ name: "Tailwind CSS", bucket: "library", pattern: /tailwindcss|tw-elements/ },
];

function bodySignatures(html: string): DetectionEvidence[] {
	const out: DetectionEvidence[] = [];
	for (const sig of BODY_SIGNATURES) {
		const m = html.match(sig.pattern);
		if (!m) continue;
		const ev: DetectionEvidence = {
			name: sig.name,
			evidence: m[0].slice(0, 80),
			source: "body",
			confidence: 0.85,
		};
		if (sig.versionPattern) {
			const vMatch = html.match(sig.versionPattern);
			if (vMatch) ev.version = vMatch[1];
		}
		out.push(ev);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Main logic
// ---------------------------------------------------------------------------

export async function deepDetect(url: string, insecure = false): Promise<DeepDetectionResult> {
	const target = new URL(url);
	const hostname = target.hostname;

	const r = await bxcFetch(url, { insecure, timeoutMs: 20_000 });
	const headers: Record<string, string> = {};
	r.headers.forEach((v, k) => {
		headers[k.toLowerCase()] = v;
	});
	const body = await r.text();

	const [nsRecords, ips, cnames] = await Promise.all([
		safeResolveNs(hostname),
		safeResolve4(hostname),
		safeResolveCname(hostname),
	]);

	const reversePtr: Record<string, string[]> = {};
	const ptrPromises = ips.slice(0, 3).map(async (ip) => {
		reversePtr[ip] = await safeReverse(ip);
	});
	await Promise.all(ptrPromises);

	const wapp = await detectFrameworks({ html: body, headers: {} }, { insecure }).catch(() => []);

	const result: DeepDetectionResult = {
		url,
		finalUrl: r.url,
		httpStatus: r.status,
		hostname,
		resolvedIps: ips,
		cnameChain: cnames,
		nsRecords,
		reversePtr,
		frontend: [],
		backend: [],
		cdn: [],
		dns: [],
		hosting: [],
		server: [],
		language: [],
		cms: [],
		analytics: [],
		tagManagers: [],
		framework: [],
		library: [],
		other: [],
	};

	const push = (bucket: DetectionBucket, ev: DetectionEvidence): void => {
		const target = bucketArray(result, bucket);
		if (!target.some((x) => x.name === ev.name && x.source === ev.source)) {
			target.push(ev);
		}
	};

	for (const ev of fingerprintHeaders(headers)) {
		const bucket = HEADER_FINGERPRINTS.find((f) => f.name === ev.name)?.bucket ?? "other";
		push(bucket, ev);
	}
	for (const ns of nsRecords) {
		const provider = nsToProvider(ns);
		if (provider) push("dns", { name: provider, evidence: `ns:${ns}`, source: "dns" });
	}
	for (const cname of cnames) {
		const m = cnameToProvider(cname);
		if (m) push(m.bucket, { name: m.name, evidence: `cname:${cname}`, source: "dns" });
	}
	for (const ip of ips) {
		const cdn = ipToCdn(ip);
		if (cdn) push("cdn", { name: cdn, evidence: `ip:${ip}`, source: "ip" });
	}
	for (const ev of bodySignatures(body)) {
		const bucket = BODY_SIGNATURES.find((s) => s.name === ev.name)?.bucket ?? "other";
		push(bucket, ev);
	}
	for (const w of wapp) {
		push(wappBucket(w.categories), {
			name: w.name,
			evidence: "wappalyzer",
			source: "wappalyzer",
			version: w.version,
		});
	}

	return result;
}

function bucketArray(r: DeepDetectionResult, bucket: DetectionBucket): DetectionEvidence[] {
	switch (bucket) {
		case "frontend": return r.frontend;
		case "backend": return r.backend;
		case "cdn": return r.cdn;
		case "dns": return r.dns;
		case "hosting": return r.hosting;
		case "server": return r.server;
		case "language": return r.language;
		case "cms": return r.cms;
		case "analytics": return r.analytics;
		case "tag-manager": return r.tagManagers;
		case "framework": return r.framework;
		case "library": return r.library;
		default: return r.other;
	}
}

function wappBucket(categories: string[] = []): DetectionBucket {
	const map: Record<string, DetectionBucket> = {
		"javascript frameworks": "frontend",
		"web frameworks": "backend",
		cms: "cms",
		"javascript libraries": "library",
		analytics: "analytics",
		cdn: "cdn",
	};
	for (const c of categories) {
		const lower = c.toLowerCase();
		if (lower in map) return map[lower];
	}
	return "other";
}

async function safeResolveNs(host: string): Promise<string[]> {
	try {
		return await nodeDns.resolveNs(host);
	} catch {
		return [];
	}
}
async function safeResolve4(host: string): Promise<string[]> {
	try {
		return await nodeDns.resolve4(host);
	} catch {
		return [];
	}
}
async function safeResolveCname(host: string): Promise<string[]> {
	try {
		return await nodeDns.resolveCname(host);
	} catch {
		return [];
	}
}
async function safeReverse(ip: string): Promise<string[]> {
	try {
		return await nodeDns.reverse(ip);
	} catch {
		return [];
	}
}
