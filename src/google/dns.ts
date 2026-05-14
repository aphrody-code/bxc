/**
 * @module bunlight/google/dns
 *
 * DNS and IP ASN checks to identify Google-owned infrastructure.
 */

/**
 * Check if a hostname belongs to a known Google domain.
 */
const GOOGLE_DOMAINS = new Set([
	"google.com",
	"google.ad",
	"google.ae",
	"google.com.af",
	"google.com.ag",
	"google.al",
	"google.am",
	"google.co.ao",
	"google.com.ar",
	"google.as",
	"google.at",
	"google.com.au",
	"google.az",
	"google.ba",
	"google.com.bd",
	"google.be",
	"google.bf",
	"google.bg",
	"google.com.bh",
	"google.bi",
	"google.bj",
	"google.com.bn",
	"google.com.bo",
	"google.com.br",
	"google.bs",
	"google.bt",
	"google.co.bw",
	"google.by",
	"google.com.bz",
	"google.ca",
	"google.cd",
	"google.cf",
	"google.cg",
	"google.ch",
	"google.ci",
	"google.co.ck",
	"google.cl",
	"google.cm",
	"google.cn",
	"google.com.co",
	"google.com.cr",
	"google.com.cu",
	"google.cv",
	"google.com.cy",
	"google.cz",
	"google.de",
	"google.dj",
	"google.dk",
	"google.dm",
	"google.com.do",
	"google.dz",
	"google.com.ec",
	"google.ee",
	"google.com.eg",
	"google.es",
	"google.com.et",
	"google.fi",
	"google.com.fj",
	"google.fm",
	"google.fr",
	"google.ga",
	"google.ge",
	"google.gg",
	"google.com.gh",
	"google.com.gi",
	"google.gl",
	"google.gm",
	"google.gp",
	"google.gr",
	"google.com.gt",
	"google.gy",
	"google.com.hk",
	"google.hn",
	"google.hr",
	"google.ht",
	"google.hu",
	"google.co.id",
	"google.ie",
	"google.co.il",
	"google.im",
	"google.co.in",
	"google.iq",
	"google.is",
	"google.it",
	"google.je",
	"google.com.jm",
	"google.jo",
	"google.co.jp",
	"google.co.ke",
	"google.com.kh",
	"google.ki",
	"google.kg",
	"google.co.kr",
	"google.com.kw",
	"google.kz",
	"google.la",
	"google.com.lb",
	"google.li",
	"google.lk",
	"google.co.ls",
	"google.lt",
	"google.lu",
	"google.lv",
	"google.com.ly",
	"google.co.ma",
	"google.md",
	"google.me",
	"google.mg",
	"google.mk",
	"google.ml",
	"google.com.mm",
	"google.mn",
	"google.ms",
	"google.com.mt",
	"google.mu",
	"google.mv",
	"google.mw",
	"google.com.mx",
	"google.com.my",
	"google.co.mz",
	"google.com.na",
	"google.com.ng",
	"google.com.ni",
	"google.ne",
	"google.nl",
	"google.no",
	"google.com.np",
	"google.nr",
	"google.nu",
	"google.co.nz",
	"google.com.om",
	"google.com.pa",
	"google.com.pe",
	"google.com.pg",
	"google.com.ph",
	"google.com.pk",
	"google.pl",
	"google.pn",
	"google.com.pr",
	"google.ps",
	"google.pt",
	"google.com.py",
	"google.com.qa",
	"google.ro",
	"google.ru",
	"google.rw",
	"google.com.sa",
	"google.com.sb",
	"google.sc",
	"google.se",
	"google.com.sg",
	"google.sh",
	"google.si",
	"google.sk",
	"google.com.sl",
	"google.sn",
	"google.so",
	"google.sm",
	"google.sr",
	"google.st",
	"google.com.sv",
	"google.td",
	"google.tg",
	"google.co.th",
	"google.com.tj",
	"google.tl",
	"google.tm",
	"google.tn",
	"google.to",
	"google.com.tr",
	"google.tt",
	"google.com.tw",
	"google.co.tz",
	"google.com.ua",
	"google.co.ug",
	"google.co.uk",
	"google.com.uy",
	"google.co.uz",
	"google.com.vc",
	"google.co.ve",
	"google.vg",
	"google.co.vi",
	"google.com.vn",
	"google.vu",
	"google.ws",
	"google.rs",
	"google.co.za",
	"google.co.zm",
	"google.co.zw",
	"googleadservices.com",
	"googleanalytics.com",
	"googleapis.com",
	"googlecommerce.com",
	"googlevideo.com",
	"googletagmanager.com",
	"googletagservices.com",
	"googlesyndication.com",
	"google-analytics.com",
	"gstatic.com",
	"googleusercontent.com",
	"googlehosted.com",
	"googlezip.net",
	"gmail.com",
	"youtube.com",
	"youtu.be",
	"ytimg.com",
	"ggpht.com",
	"blogger.com",
	"blogspot.com",
	"chrome.com",
	"chromium.org",
	"android.com",
	"material.io",
	"antigravity.google",
	"design.google",
	"gemini.google",
	"geminicli.com",
	"vertexai.google",
	"firebaseapp.com",
	"firebaseio.com",
	"appspot.com",
	"doubleclick.net",
	"go.dev",
	"golang.org",
	"tensorflow.org",
	"angular.io",
	"angular.dev",
	"flutter.dev",
	"dart.dev",
	"web.dev",
	"lit.dev",
	"polymer-project.org",
	"gwtproject.org",
	"withgoogle.com",
	"google.dev",
	"google.net",
	"google.org",
	"chrome.google.com",
	"dl.google.com",
	"ajax.googleapis.com",
	"fonts.googleapis.com",
	"fonts.gstatic.com",
	"storage.googleapis.com",
	"maps.googleapis.com",
	"maps.gstatic.com",
	"csi.gstatic.com",
	"ssl.gstatic.com",
	"encrypted-tbn0.gstatic.com",
	"lh1.googleusercontent.com",
	"lh2.googleusercontent.com",
	"lh3.googleusercontent.com",
	"lh4.googleusercontent.com",
	"lh5.googleusercontent.com",
	"lh6.googleusercontent.com",
]);

/**
 * Check if a hostname belongs to a known Google domain.
 */
export function isGoogleDomain(hostname: string): boolean {
	const h = hostname.toLowerCase();
	if (GOOGLE_DOMAINS.has(h)) return true;

	let current = h;
	while (true) {
		const idx = current.indexOf(".");
		if (idx === -1) break;
		current = current.slice(idx + 1);
		if (GOOGLE_DOMAINS.has(current)) return true;
	}

	return false;
}

/**
 * Check if the DNS records for a domain point to Google infrastructure.
 * Uses dig (NS/MX) when available, otherwise probes Cloudflare DoH JSON API.
 */
export async function isGoogleInfrastructure(
	hostname: string,
): Promise<boolean> {
	if (isGoogleDomain(hostname)) return true;

	try {
		const proc = Bun.spawn(["dig", "NS", hostname, "+short"], {
			stdout: "pipe",
			stderr: "ignore",
		});
		const output = (await new Response(proc.stdout).text()).toLowerCase();
		if (output.includes("google.com") || output.includes("googledomains.com")) {
			return true;
		}

		const procMx = Bun.spawn(["dig", "MX", hostname, "+short"], {
			stdout: "pipe",
			stderr: "ignore",
		});
		const outputMx = (await new Response(procMx.stdout).text()).toLowerCase();
		if (
			outputMx.includes("google.com") ||
			outputMx.includes("googlemail.com")
		) {
			return true;
		}
	} catch {
		/* dig unavailable — fall through to DoH */
	}

	return await isGoogleViaDoh(hostname);
}

/**
 * Resolve A records via Cloudflare DNS-over-HTTPS and check whether any
 * resolved IP belongs to a Google-owned netblock (AS15169 — common /16s).
 */
async function isGoogleViaDoh(hostname: string): Promise<boolean> {
	try {
		const res = await fetch(
			`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
			{
				headers: { Accept: "application/dns-json" },
				signal: AbortSignal.timeout(4000),
			},
		);
		if (!res.ok) return false;
		const json = (await res.json()) as {
			Answer?: Array<{ data: string; type: number }>;
		};
		for (const a of json.Answer ?? []) {
			if (a.type === 1 && isGoogleIp(a.data)) return true;
		}
	} catch {
		/* swallow */
	}
	return false;
}

/**
 * Heuristic: returns true when an IPv4 address falls in a well-known
 * Google netblock (AS15169 / Google LLC). Not exhaustive — covers the
 * commonly-encountered ranges for serving infrastructure.
 */
export function isGoogleIp(ip: string): boolean {
	const parts = ip.split(".").map(Number);
	if (
		parts.length !== 4 ||
		parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
	) {
		return false;
	}
	const [a, b] = parts;
	// 8.8.8.0/24, 8.8.4.0/24 (Public DNS)
	if (a === 8 && (b === 8 || b === 34 || b === 35)) return true;
	// 34.0.0.0/8 (GCP overlap — partial)
	if (a === 34 && b >= 64 && b <= 127) return true;
	// 35.184.0.0/13, 35.192.0.0/14, 35.196.0.0/15, 35.198.0.0/16, 35.199.0.0/17, 35.200.0.0/13, 35.208.0.0/12, 35.224.0.0/12, 35.240.0.0/13
	if (a === 35 && b >= 184 && b <= 247) return true;
	// 64.18.0.0/20, 64.233.160.0/19
	if (a === 64 && (b === 18 || b === 233)) return true;
	// 66.102.0.0/20, 66.249.64.0/19 (Googlebot)
	if (a === 66 && (b === 102 || b === 249)) return true;
	// 72.14.192.0/18
	if (a === 72 && b === 14) return true;
	// 74.125.0.0/16
	if (a === 74 && b === 125) return true;
	// 108.177.0.0/17, 108.59.80.0/21
	if (a === 108 && (b === 177 || b === 59)) return true;
	// 142.250.0.0/15, 142.251.0.0/16
	if (a === 142 && (b === 250 || b === 251)) return true;
	// 172.217.0.0/16, 172.253.0.0/16
	if (a === 172 && (b === 217 || b === 253)) return true;
	// 173.194.0.0/16
	if (a === 173 && b === 194) return true;
	// 192.178.0.0/15
	if (a === 192 && (b === 178 || b === 179)) return true;
	// 209.85.128.0/17
	if (a === 209 && b === 85) return true;
	// 216.58.192.0/19, 216.239.32.0/19
	if (a === 216 && (b === 58 || b === 239)) return true;
	return false;
}

/** Reserved Google country-code TLDs (subset). Useful for routing localized SERPs. */
const GOOGLE_TLDS = new Set([
	"com",
	"ad",
	"ae",
	"af",
	"ag",
	"al",
	"am",
	"ao",
	"ar",
	"as",
	"at",
	"au",
	"az",
	"ba",
	"bd",
	"be",
	"bf",
	"bg",
	"bh",
	"bi",
	"bj",
	"bn",
	"bo",
	"br",
	"bs",
	"bt",
	"bw",
	"by",
	"bz",
	"ca",
	"cd",
	"cf",
	"cg",
	"ch",
	"ci",
	"ck",
	"cl",
	"cm",
	"cn",
	"co",
	"cr",
	"cu",
	"cv",
	"cy",
	"cz",
	"de",
	"dj",
	"dk",
	"dm",
	"do",
	"dz",
	"ec",
	"ee",
	"eg",
	"es",
	"et",
	"fi",
	"fj",
	"fm",
	"fr",
	"ga",
	"ge",
	"gg",
	"gh",
	"gi",
	"gl",
	"gm",
	"gp",
	"gr",
	"gt",
	"gy",
	"hk",
	"hn",
	"hr",
	"ht",
	"hu",
	"id",
	"ie",
	"il",
	"im",
	"in",
	"iq",
	"is",
	"it",
	"je",
	"jm",
	"jo",
	"jp",
	"ke",
	"kh",
	"ki",
	"kg",
	"kr",
	"kw",
	"kz",
	"la",
	"lb",
	"li",
	"lk",
	"ls",
	"lt",
	"lu",
	"lv",
	"ly",
	"ma",
	"md",
	"me",
	"mg",
	"mk",
	"ml",
	"mm",
	"mn",
	"ms",
	"mt",
	"mu",
	"mv",
	"mw",
	"mx",
	"my",
	"mz",
	"na",
	"ng",
	"ni",
	"ne",
	"nl",
	"no",
	"np",
	"nr",
	"nu",
	"nz",
	"om",
	"pa",
	"pe",
	"pg",
	"ph",
	"pk",
	"pl",
	"pn",
	"pr",
	"ps",
	"pt",
	"py",
	"qa",
	"ro",
	"ru",
	"rw",
	"sa",
	"sb",
	"sc",
	"se",
	"sg",
	"sh",
	"si",
	"sk",
	"sl",
	"sn",
	"so",
	"sm",
	"sr",
	"st",
	"sv",
	"td",
	"tg",
	"th",
	"tj",
	"tl",
	"tm",
	"tn",
	"to",
	"tr",
	"tt",
	"tw",
	"tz",
	"ua",
	"ug",
	"uk",
	"uy",
	"uz",
	"vc",
	"ve",
	"vg",
	"vi",
	"vn",
	"vu",
	"ws",
	"rs",
	"za",
	"zm",
	"zw",
]);

/**
 * Map an ISO 3166-1 alpha-2 country code to its corresponding google.<tld>
 * domain (e.g. "FR" -> "google.fr", "JP" -> "google.co.jp"). Returns
 * "google.com" when no localized domain is known.
 */
export function getGoogleDomainForCountry(country: string): string {
	const c = country.toLowerCase();
	const composites: Record<string, string> = {
		uk: "google.co.uk",
		jp: "google.co.jp",
		kr: "google.co.kr",
		in: "google.co.in",
		il: "google.co.il",
		nz: "google.co.nz",
		za: "google.co.za",
		id: "google.co.id",
		ke: "google.co.ke",
		th: "google.co.th",
		ug: "google.co.ug",
		tz: "google.co.tz",
		ao: "google.co.ao",
		bw: "google.co.bw",
		ck: "google.co.ck",
		ls: "google.co.ls",
		ma: "google.co.ma",
		mz: "google.co.mz",
		ve: "google.co.ve",
		uz: "google.co.uz",
		zm: "google.co.zm",
		zw: "google.co.zw",
		vi: "google.co.vi",
		us: "google.com",
	};
	if (composites[c]) return composites[c];
	const composedCom = [
		"af",
		"ar",
		"au",
		"bd",
		"bh",
		"bo",
		"br",
		"co",
		"cr",
		"cu",
		"do",
		"ec",
		"eg",
		"et",
		"fj",
		"gh",
		"gi",
		"gt",
		"hk",
		"jm",
		"kh",
		"kw",
		"lb",
		"ly",
		"mm",
		"mt",
		"mx",
		"my",
		"na",
		"ng",
		"ni",
		"om",
		"pa",
		"pe",
		"pg",
		"ph",
		"pk",
		"pr",
		"py",
		"qa",
		"sa",
		"sb",
		"sg",
		"sl",
		"sv",
		"tj",
		"tr",
		"tw",
		"ua",
		"uy",
		"vc",
		"vn",
	];
	if (composedCom.includes(c)) return `google.com.${c}`;
	if (GOOGLE_TLDS.has(c)) return `google.${c}`;
	return "google.com";
}
