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
 * @module bunlight/detect-deep
 *
 * Multi-signal detection of frontend, backend, CDN, DNS, hosting, and
 * analytics technologies behind a URL.
 *
 * Sources combined:
 *   1. Authoritative response headers (Server, X-Powered-By, X-Cache,
 *      X-Vercel-*, CF-Ray, X-Amz-Cf-*, X-Akamai-*, X-Served-By, …).
 *   2. DNS records: NS (auth provider), A / AAAA (IPs),
 *      CNAME chain (often reveals Vercel/Netlify/Cloudflare/etc.),
 *      reverse PTR lookup of resolved IPs.
 *   3. IP → CDN range matching (Cloudflare 104.16/12 + others, Fastly,
 *      AWS CloudFront, GCP, Azure Front Door, …).
 *   4. HTML body signatures (`<meta name="generator">`, `_next/static`,
 *      `__nuxt`, `/wp-content/`, Svelte / Vue / React markers,
 *      Astro islands, etc.).
 *   5. CSP-allowed hosts (often expose backend CMS).
 *   6. Wappalyzergo for everything else (Tag Managers, JS libs, etc.).
 *
 * The module exports a single async entrypoint:
 *
 *   const result = await deepDetect("https://design.google");
 *
 * Result shape is structured to be agent-friendly: every field is either
 * an array of `{ name, evidence, source }` or a string-keyed map keyed by
 * detection bucket (frontend / backend / cdn / dns / hosting / analytics
 * / language / server / cms).
 */

// DNS: Bun.dns is native (cached, prefetch-aware) for A/AAAA lookups.
// NS / CNAME / PTR record types are not exposed by Bun.dns yet — fall back
// to node:dns/promises (Bun-compat) for those. https://bun.com/docs/runtime/networking/dns
import { promises as nodeDns } from "node:dns";
import { detectFrameworks } from "./detect.ts";

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
	/** Human-readable name (e.g. `"Next.js"`, `"Cloudflare"`). */
	name: string;
	/** Evidence excerpt that triggered the match (truncated). */
	evidence: string;
	/** Source signal: `"header"`, `"dns"`, `"ip"`, `"body"`, `"csp"`, `"wappalyzer"`, `"cert"`. */
	source: string;
	/** Optional confidence score 0..1. */
	confidence?: number;
	/** Optional version string. */
	version?: string;
	/** Optional category list returned by wappalyzergo. */
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
// IP range tables (compact, common-case CDNs)
// ---------------------------------------------------------------------------

/**
 * Static IPv4 prefix tables. We do NOT fetch live ranges — that would be
 * a data source dependency. These are the canonical CIDR prefixes shipped
 * by each provider in 2025-2026 (top of their published ranges).
 */
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
	{
		name: "Vercel",
		prefixes: ["76.76.21.", "76.76.19.", "64.252."],
	},
	{
		name: "Netlify",
		prefixes: ["75.2.", "99.83.", "13.249.", "151.101."],
	},
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
	{
		name: "Heroku",
		prefixes: ["54.144.", "54.158.", "54.159.", "54.161.", "54.165.", "54.166."],
	},
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
// NS → DNS provider mapping
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
	{ name: "Cloudflare Registrar", matches: /\.cloudflare-dns\.com$/i },
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

// ---------------------------------------------------------------------------
// CNAME → hosting provider
// ---------------------------------------------------------------------------

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
		name: "Google Cloud Run / App Engine",
		bucket: "hosting",
		matches: /\.appspot\.com$|\.run\.app$|\.googleapis\.com$/i,
	},
	{
		name: "AWS S3",
		bucket: "hosting",
		matches: /\.s3\.amazonaws\.com$|\.s3-website[.-].*\.amazonaws\.com$/i,
	},
	{ name: "AWS CloudFront", bucket: "cdn", matches: /\.cloudfront\.net$/i },
	{ name: "AWS Elastic Beanstalk", bucket: "hosting", matches: /\.elasticbeanstalk\.com$/i },
	{ name: "Azure Static Web Apps", bucket: "hosting", matches: /\.azurestaticapps\.net$/i },
	{ name: "Azure App Service", bucket: "hosting", matches: /\.azurewebsites\.net$/i },
	{ name: "Cloudflare Pages", bucket: "hosting", matches: /\.pages\.dev$/i },
	{ name: "Fastly", bucket: "cdn", matches: /\.fastly\.net$|\.fastlylb\.net$/i },
	{ name: "Akamai", bucket: "cdn", matches: /\.akamaiedge\.net$|\.akamaitechnologies\.com$/i },
	{ name: "Cloudflare", bucket: "cdn", matches: /\.cloudflare\.com$/i },
	{ name: "BunnyCDN", bucket: "cdn", matches: /\.b-cdn\.net$/i },
	{ name: "KeyCDN", bucket: "cdn", matches: /\.kxcdn\.com$/i },
	{ name: "Shopify", bucket: "hosting", matches: /\.myshopify\.com$|shopify\.com$/i },
	{ name: "Squarespace", bucket: "hosting", matches: /\.squarespace\.com$/i },
	{ name: "Wix", bucket: "hosting", matches: /\.wixsite\.com$|\.wix\.com$/i },
	{ name: "Webflow", bucket: "hosting", matches: /\.webflow\.io$|\.webflow\.com$/i },
];

function cnameToProvider(cname: string): { name: string; bucket: DetectionBucket } | null {
	for (const p of CNAME_HOSTING_PATTERNS) {
		if (p.matches.test(cname)) return { name: p.name, bucket: p.bucket };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Header → CDN/server fingerprinting
// ---------------------------------------------------------------------------

const HEADER_FINGERPRINTS: Array<{
	name: string;
	bucket: DetectionBucket;
	header: string;
	match?: RegExp;
}> = [
	// CDN
	{ name: "Cloudflare", bucket: "cdn", header: "cf-ray" },
	{ name: "Cloudflare", bucket: "cdn", header: "cf-cache-status" },
	{ name: "Cloudflare", bucket: "cdn", header: "cf-mitigated" },
	{ name: "AWS CloudFront", bucket: "cdn", header: "x-amz-cf-id" },
	{ name: "AWS CloudFront", bucket: "cdn", header: "x-amz-cf-pop" },
	{ name: "Fastly", bucket: "cdn", header: "x-served-by", match: /^cache-/i },
	{ name: "Fastly", bucket: "cdn", header: "x-fastly-request-id" },
	{ name: "Akamai", bucket: "cdn", header: "x-akamai-edge" },
	{ name: "Akamai", bucket: "cdn", header: "x-akamai-transformed" },
	{ name: "Vercel", bucket: "cdn", header: "x-vercel-id" },
	{ name: "Vercel", bucket: "cdn", header: "x-vercel-cache" },
	{ name: "Netlify", bucket: "cdn", header: "x-nf-request-id" },
	{ name: "Cloudflare Workers", bucket: "hosting", header: "cf-worker" },
	{ name: "Google Developers Pages", bucket: "hosting", header: "x-github-request-id" },
	{ name: "Google Cloud", bucket: "hosting", header: "x-cloud-trace-context" },
	{ name: "Google Frontend", bucket: "cdn", header: "server", match: /^Google Frontend$/i },
	// Server
	{ name: "nginx", bucket: "server", header: "server", match: /nginx/i },
	{ name: "Apache", bucket: "server", header: "server", match: /apache/i },
	{ name: "Caddy", bucket: "server", header: "server", match: /caddy/i },
	{ name: "Microsoft IIS", bucket: "server", header: "server", match: /iis/i },
	{ name: "LiteSpeed", bucket: "server", header: "server", match: /litespeed/i },
	{ name: "Envoy", bucket: "server", header: "server", match: /envoy/i },
	// Backend
	{ name: "Next.js", bucket: "backend", header: "x-powered-by", match: /next\.js/i },
	{ name: "Express.js", bucket: "backend", header: "x-powered-by", match: /express/i },
	{ name: "PHP", bucket: "language", header: "x-powered-by", match: /php\//i },
	{ name: "ASP.NET", bucket: "backend", header: "x-powered-by", match: /asp\.net/i },
	{ name: "Ruby on Rails", bucket: "backend", header: "x-powered-by", match: /rails/i },
	{ name: "Phusion Passenger", bucket: "backend", header: "server", match: /passenger/i },
	{ name: "Django", bucket: "backend", header: "x-powered-by", match: /django/i },
	{ name: "Laravel", bucket: "backend", header: "x-powered-by", match: /laravel/i },
	{ name: "Wordpress", bucket: "cms", header: "x-powered-by", match: /wp[\s-]?engine|wordpress/i },
	// Generic
	{ name: "HTTP/2", bucket: "other", header: "alt-svc", match: /h2/i },
	{ name: "HTTP/3 (QUIC)", bucket: "other", header: "alt-svc", match: /h3/i },
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
// HTML body signatures
// ---------------------------------------------------------------------------

const BODY_SIGNATURES: Array<{
	name: string;
	bucket: DetectionBucket;
	pattern: RegExp;
	versionPattern?: RegExp;
}> = [
	// Frontend frameworks
	{
		name: "Next.js",
		bucket: "frontend",
		pattern: /\/_next\/static\//,
		versionPattern: /Next\.js v(\d+\.\d+\.\d+)/,
	},
	{ name: "Nuxt.js", bucket: "frontend", pattern: /\/_nuxt\/|window\.__NUXT__/ },
	{ name: "Astro", bucket: "frontend", pattern: /<astro-island|astro-slot|data-astro-/ },
	{ name: "SvelteKit", bucket: "frontend", pattern: /\/_app\/immutable\/|sveltekit/i },
	{ name: "Svelte", bucket: "frontend", pattern: /data-svelte-h="|svelte-/ },
	{
		name: "Vue.js",
		bucket: "frontend",
		pattern: /data-v-[a-f0-9]{8}|__VUE__|<div id="app"|window\.__INITIAL_STATE__/,
	},
	{
		name: "React",
		bucket: "frontend",
		pattern: /__react_internal|data-reactroot|data-reactid|window\.__INITIAL_STATE__/,
	},
	{ name: "Remix", bucket: "frontend", pattern: /__remix-/ },
	{ name: "Angular", bucket: "frontend", pattern: /ng-version="|ng-app|ng-controller/ },
	{ name: "Solid.js", bucket: "frontend", pattern: /_$HY=|hk:".+":/ },
	{ name: "Qwik", bucket: "frontend", pattern: /q:container=|q:base=/ },
	{ name: "Gatsby", bucket: "frontend", pattern: /__gatsby|gatsby-link/ },
	{ name: "Hugo", bucket: "frontend", pattern: /<meta name="generator" content="Hugo/i },
	{ name: "Jekyll", bucket: "frontend", pattern: /<meta name="generator" content="Jekyll/i },
	{ name: "Eleventy", bucket: "frontend", pattern: /<meta name="generator" content="Eleventy/i },
	{ name: "VitePress", bucket: "frontend", pattern: /<!-- vitepress-/ },
	{ name: "Docusaurus", bucket: "frontend", pattern: /<!-- docusaurus|docusaurus_skip/ },
	// CMS
	{ name: "WordPress", bucket: "cms", pattern: /\/wp-content\/|\/wp-includes\/|wp-json/ },
	{ name: "Drupal", bucket: "cms", pattern: /\/sites\/default\/files\/|drupalSettings|drupal\.js/ },
	{ name: "Joomla", bucket: "cms", pattern: /\/media\/jui\/|joomla!\s/i },
	{ name: "Wagtail", bucket: "cms", pattern: /wagtail|<!-- powered by wagtail/i },
	{ name: "Ghost", bucket: "cms", pattern: /<meta name="generator" content="Ghost/i },
	{ name: "Strapi", bucket: "cms", pattern: /strapi-img-loader|\/api\/upload\/files/ },
	{ name: "Sanity", bucket: "cms", pattern: /cdn\.sanity\.io|sanityClient/ },
	{ name: "Contentful", bucket: "cms", pattern: /cdn\.contentful\.com|contentful\.management/ },
	{ name: "Shopify", bucket: "cms", pattern: /cdn\.shopify\.com|window\.Shopify/ },
	// Backend signatures (rare but useful)
	{ name: "Django", bucket: "backend", pattern: /csrfmiddlewaretoken|django-/ },
	{ name: "Flask", bucket: "backend", pattern: /<input[^>]*name="csrf_token"/ },
	{ name: "Laravel", bucket: "backend", pattern: /window\.Laravel/ },
	{ name: "Phoenix LiveView", bucket: "backend", pattern: /data-phx-/ },
	{ name: "Rails Turbo", bucket: "backend", pattern: /turbo-frame|turbo-stream/ },
	{ name: "Webpack", bucket: "framework", pattern: /webpackChunk|webpackJsonp/ },
	{ name: "Vite", bucket: "framework", pattern: /\/@vite\/client|@vite\/client/ },
	{ name: "Parcel", bucket: "framework", pattern: /parcelRequire/ },
	{ name: "Turbopack", bucket: "framework", pattern: /__turbopack/ },
	// Tag managers / analytics
	{
		name: "Google Tag Manager",
		bucket: "tag-manager",
		pattern: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/,
	},
	{
		name: "Google Analytics",
		bucket: "analytics",
		pattern: /googletagmanager\.com\/gtag\/js|UA-\d{6,}|G-[A-Z0-9]+/,
	},
	{ name: "Plausible", bucket: "analytics", pattern: /plausible\.io\/js\// },
	{ name: "Fathom Analytics", bucket: "analytics", pattern: /usefathom\.com\/script/ },
	{ name: "Matomo", bucket: "analytics", pattern: /matomo\.js|piwik\.js/ },
	{ name: "Segment", bucket: "analytics", pattern: /cdn\.segment\.com\/analytics/ },
	{ name: "Mixpanel", bucket: "analytics", pattern: /cdn\.mxpnl\.com\/libs\/mixpanel/ },
	{ name: "PostHog", bucket: "analytics", pattern: /app\.posthog\.com\/static\/array\.js/ },
	{ name: "Amplitude", bucket: "analytics", pattern: /cdn\.amplitude\.com/ },
	{ name: "Hotjar", bucket: "analytics", pattern: /static\.hotjar\.com/ },
	{ name: "Intercom", bucket: "analytics", pattern: /widget\.intercom\.io/ },
	// Languages
	{ name: "Lit", bucket: "library", pattern: /lit-element|lit-html|@lit\// },
	{ name: "Stimulus", bucket: "library", pattern: /data-controller="|stimulus-/ },
	{ name: "Alpine.js", bucket: "library", pattern: /x-data="|x-show="|x-bind:/ },
	{ name: "HTMX", bucket: "library", pattern: /hx-get="|hx-post="|hx-target="/ },
	{ name: "jQuery", bucket: "library", pattern: /jquery(?:\.min)?\.js|jQuery v\d/ },
	{ name: "Lodash", bucket: "library", pattern: /lodash(?:\.min)?\.js/ },
	{ name: "D3.js", bucket: "library", pattern: /d3\.v\d|d3-/ },
	{ name: "Three.js", bucket: "library", pattern: /three\.module\.js|THREE\./ },
	{
		name: "Bootstrap",
		bucket: "library",
		pattern: /bootstrap(?:\.bundle)?(?:\.min)?\.js|class="[^"]*\bnavbar\b/,
	},
	{ name: "Tailwind CSS", bucket: "library", pattern: /tailwindcss|tw-elements/ },
];

/**
 * Bun's native HTMLRewriter (lol-html) extracts <meta>/<script>/<link>
 * efficiently — see https://bun.com/docs/runtime/html-rewriter. Falls back
 * to regex when HTMLRewriter is not available (e.g. older Bun, non-Bun env).
 */
function structuredHtmlScan(html: string): {
	generator: string | null;
	scriptSrcs: string[];
	linkHrefs: string[];
} {
	let generator: string | null = null;
	const scriptSrcs: string[] = [];
	const linkHrefs: string[] = [];

	type El = { getAttribute: (name: string) => string | null };
	type RewriterCtor = new () => {
		on(selector: string, handlers: { element: (el: El) => void }): unknown;
		transform(html: string): string;
	};
	const Rewriter = (globalThis as unknown as { HTMLRewriter?: RewriterCtor }).HTMLRewriter;
	if (!Rewriter) {
		const m = html.match(/<meta\s+name=["']generator["']\s+content=["']([^"']+)["']/i);
		if (m) generator = m[1];
		for (const x of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) scriptSrcs.push(x[1]);
		for (const x of html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)) linkHrefs.push(x[1]);
		return { generator, scriptSrcs, linkHrefs };
	}

	const rw = new Rewriter();
	rw.on('meta[name="generator"]', {
		element(el) {
			generator = el.getAttribute("content");
		},
	});
	rw.on("script[src]", {
		element(el) {
			const src = el.getAttribute("src");
			if (src) scriptSrcs.push(src);
		},
	});
	rw.on("link[href]", {
		element(el) {
			const href = el.getAttribute("href");
			if (href) linkHrefs.push(href);
		},
	});
	rw.transform(html);
	return { generator, scriptSrcs, linkHrefs };
}

function bodySignatures(html: string): DetectionEvidence[] {
	const out: DetectionEvidence[] = [];

	// A. Inline DOM markers (window.__NUXT__, data-svelte-h, etc.)
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

	// B. Structured tag scan via HTMLRewriter — catches script/link evidence
	// even when inline DOM markers are absent (e.g. Next.js with hydration off).
	const { generator, scriptSrcs, linkHrefs } = structuredHtmlScan(html);

	if (generator) {
		out.push({
			name: generator.split(/[\s\d]/)[0] ?? generator,
			evidence: `<meta generator="${generator.slice(0, 60)}">`,
			source: "body",
			confidence: 0.95,
			version: generator.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1],
		});
	}

	const seen = new Set(out.map((e) => `${e.name}|${e.source}`));
	for (const src of scriptSrcs) {
		for (const sig of BODY_SIGNATURES) {
			if (sig.pattern.test(src)) {
				const k = `${sig.name}|body`;
				if (!seen.has(k)) {
					out.push({
						name: sig.name,
						evidence: `script:${src.slice(0, 80)}`,
						source: "body",
						confidence: 0.9,
					});
					seen.add(k);
				}
			}
		}
	}
	for (const href of linkHrefs) {
		for (const sig of BODY_SIGNATURES) {
			if (sig.pattern.test(href)) {
				const k = `${sig.name}|body`;
				if (!seen.has(k)) {
					out.push({
						name: sig.name,
						evidence: `link:${href.slice(0, 80)}`,
						source: "body",
						confidence: 0.85,
					});
					seen.add(k);
				}
			}
		}
	}

	return out;
}

// ---------------------------------------------------------------------------
// CSP-allowed hosts → backend / CMS hints
// ---------------------------------------------------------------------------

const CSP_BACKEND_HINTS: Array<{ pattern: RegExp; name: string; bucket: DetectionBucket }> = [
	{ pattern: /\.appspot\.com$/i, name: "Google App Engine", bucket: "hosting" },
	{ pattern: /\.run\.app$/i, name: "Google Cloud Run", bucket: "hosting" },
	{ pattern: /wagtail/i, name: "Wagtail CMS", bucket: "cms" },
	{ pattern: /^cms-dot-.+\.appspot\.com$/i, name: "Custom CMS on App Engine", bucket: "cms" },
	{ pattern: /\.contentful\.com$/i, name: "Contentful", bucket: "cms" },
	{ pattern: /cdn\.sanity\.io$/i, name: "Sanity", bucket: "cms" },
	{ pattern: /\.intercom-/i, name: "Intercom", bucket: "analytics" },
	{ pattern: /\.googletagmanager\.com$/i, name: "Google Tag Manager", bucket: "tag-manager" },
	{ pattern: /\.google-analytics\.com$/i, name: "Google Analytics", bucket: "analytics" },
];

function cspToHints(cspHosts: string[]): DetectionEvidence[] {
	const out: DetectionEvidence[] = [];
	for (const host of cspHosts) {
		for (const h of CSP_BACKEND_HINTS) {
			if (h.pattern.test(host)) {
				out.push({
					name: h.name,
					evidence: `csp:${host}`,
					source: "csp",
					confidence: 0.7,
				});
				break;
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Bucket assignment from wappalyzer category
// ---------------------------------------------------------------------------

const WAPP_CATEGORY_TO_BUCKET: Record<string, DetectionBucket> = {
	"javascript frameworks": "frontend",
	"web frameworks": "backend",
	"static site generator": "frontend",
	cms: "cms",
	"javascript libraries": "library",
	"ui frameworks": "frontend",
	"tag managers": "tag-manager",
	analytics: "analytics",
	"web servers": "server",
	caching: "cdn",
	cdn: "cdn",
	"reverse proxies": "server",
	"programming languages": "language",
	"paas / hosting": "hosting",
	hosting: "hosting",
	"page builders": "frontend",
	"e-commerce": "cms",
};

function wappBucket(categories: string[] = []): DetectionBucket {
	for (const c of categories) {
		const lower = c.toLowerCase();
		if (lower in WAPP_CATEGORY_TO_BUCKET) return WAPP_CATEGORY_TO_BUCKET[lower];
	}
	return "other";
}

// ---------------------------------------------------------------------------
// DNS lookups (best-effort, swallows errors)
// ---------------------------------------------------------------------------

async function safeResolveNs(host: string): Promise<string[]> {
	// Try host + parent zone (NS records typically live on the apex domain).
	const parts = host.split(".");
	const candidates = parts.length > 2 ? [host, parts.slice(-2).join(".")] : [host];
	for (const c of candidates) {
		try {
			const ns = await nodeDns.resolveNs(c);
			if (ns.length > 0) return ns;
		} catch {
			// try next candidate
		}
	}
	return [];
}

/**
 * A-record lookup via Bun.dns (native, cached) when available; falls back
 * to node:dns/promises for environments where Bun.dns is unavailable.
 * Bun.dns.lookup hits the OS resolver but caches results in-process —
 * see https://bun.com/docs/runtime/networking/dns.
 */
async function safeResolve4(host: string): Promise<string[]> {
	const bunDns = (Bun as unknown as { dns?: { lookup: Function } }).dns;
	if (bunDns?.lookup) {
		try {
			const r = (await bunDns.lookup(host, { family: 4, all: true })) as Array<{
				address: string;
			}>;
			return r.map((x) => x.address);
		} catch {
			// fall through
		}
	}
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

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function deepDetect(url: string): Promise<DeepDetectionResult> {
	const target = new URL(url);
	const hostname = target.hostname;

	// Step 1: HTTP fetch (headers + body)
	const r = await fetch(url, {
		method: "GET",
		signal: AbortSignal.timeout(20_000),
		redirect: "follow",
		headers: {
			"User-Agent":
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		},
	});
	const headers: Record<string, string> = {};
	r.headers.forEach((v, k) => {
		headers[k.toLowerCase()] = v;
	});
	const body = await r.text();

	// Step 2: DNS lookups in parallel
	const [nsRecords, ips, cnames] = await Promise.all([
		safeResolveNs(hostname),
		safeResolve4(hostname),
		safeResolveCname(hostname),
	]);

	// Reverse PTR for each IP (limited to first 3)
	const reversePtr: Record<string, string[]> = {};
	const ptrPromises = ips.slice(0, 3).map(async (ip) => {
		reversePtr[ip] = await safeReverse(ip);
	});
	await Promise.all(ptrPromises);

	// Step 3: Wappalyzergo enrichment
	const wapp = await detectFrameworks({ html: body, headers: {} }).catch(() => []);

	// Step 4: Score & assign to buckets
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
		// Dedupe by name+source
		if (!target.some((x) => x.name === ev.name && x.source === ev.source)) {
			target.push(ev);
		}
	};

	// 4.1 Headers
	for (const ev of fingerprintHeaders(headers)) {
		const bucket = HEADER_FINGERPRINTS.find((f) => f.name === ev.name)?.bucket ?? "other";
		push(bucket, ev);
	}

	// 4.2 NS records → DNS provider
	for (const ns of nsRecords) {
		const provider = nsToProvider(ns);
		if (provider) {
			push("dns", { name: provider, evidence: `ns:${ns}`, source: "dns", confidence: 0.95 });
		}
	}

	// 4.3 CNAME → hosting / CDN
	for (const cname of cnames) {
		const m = cnameToProvider(cname);
		if (m) {
			push(m.bucket, { name: m.name, evidence: `cname:${cname}`, source: "dns", confidence: 0.9 });
		}
	}

	// 4.4 Reverse PTR → CDN
	for (const ip of Object.keys(reversePtr)) {
		for (const ptr of reversePtr[ip]) {
			const m = cnameToProvider(ptr);
			if (m) {
				push(m.bucket, { name: m.name, evidence: `ptr:${ptr}`, source: "dns", confidence: 0.85 });
			}
		}
	}

	// 4.5 IP ranges
	for (const ip of ips) {
		const cdn = ipToCdn(ip);
		if (cdn) {
			push("cdn", { name: cdn, evidence: `ip:${ip}`, source: "ip", confidence: 0.9 });
		}
	}

	// 4.6 CSP hosts → backend hints
	const csp = headers["content-security-policy"] ?? "";
	const cspHosts = extractCspHosts(csp);
	for (const ev of cspToHints(cspHosts)) {
		const bucket = CSP_BACKEND_HINTS.find((h) => h.name === ev.name)?.bucket ?? "other";
		push(bucket, ev);
	}

	// 4.7 Body signatures
	for (const ev of bodySignatures(body)) {
		const bucket = BODY_SIGNATURES.find((s) => s.name === ev.name)?.bucket ?? "other";
		push(bucket, ev);
	}

	// 4.8 Wappalyzergo
	for (const w of wapp) {
		const bucket = wappBucket(w.categories);
		push(bucket, {
			name: w.name,
			evidence: `wappalyzer:${(w.categories ?? []).join(",")}`,
			source: "wappalyzer",
			confidence: 0.7,
			version: w.version,
			categories: w.categories,
		});
	}

	return result;
}

function bucketArray(r: DeepDetectionResult, bucket: DetectionBucket): DetectionEvidence[] {
	switch (bucket) {
		case "frontend":
			return r.frontend;
		case "backend":
			return r.backend;
		case "cdn":
			return r.cdn;
		case "dns":
			return r.dns;
		case "hosting":
			return r.hosting;
		case "server":
			return r.server;
		case "language":
			return r.language;
		case "cms":
			return r.cms;
		case "analytics":
			return r.analytics;
		case "tag-manager":
			return r.tagManagers;
		case "framework":
			return r.framework;
		case "library":
			return r.library;
		default:
			return r.other;
	}
}

function extractCspHosts(csp: string): string[] {
	const out = new Set<string>();
	for (const directive of csp.split(";")) {
		const trimmed = directive.trim();
		if (!trimmed) continue;
		for (const part of trimmed.split(/\s+/).slice(1)) {
			if (part.startsWith("http")) {
				try {
					out.add(new URL(part).hostname);
				} catch {
					// ignore
				}
			}
		}
	}
	return [...out];
}
