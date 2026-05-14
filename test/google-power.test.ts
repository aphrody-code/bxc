/**
 * Unit tests for the powered-up google module helpers.
 * No network — pure functions and the in-memory cache only.
 */

import { describe, expect, test } from "bun:test";
import { extractStructuredData } from "../src/google/fetch.ts";
import {
	getGoogleDomainForCountry,
	isGoogleDomain,
	isGoogleIp,
} from "../src/google/dns.ts";
import { GoogleCache } from "../src/google/cache.ts";
import { AdaptiveTokenBucket } from "../src/google/rate-limit.ts";
import { detectGoogleSpecifics } from "../src/google/detector.ts";

describe("google/dns extras", () => {
	test("isGoogleIp recognises canonical Google ranges", () => {
		expect(isGoogleIp("8.8.8.8")).toBe(true);
		expect(isGoogleIp("172.217.16.142")).toBe(true);
		expect(isGoogleIp("142.250.190.78")).toBe(true);
		expect(isGoogleIp("66.249.66.1")).toBe(true);
		expect(isGoogleIp("1.1.1.1")).toBe(false);
		expect(isGoogleIp("not.an.ip")).toBe(false);
	});

	test("getGoogleDomainForCountry returns localised TLDs", () => {
		expect(getGoogleDomainForCountry("FR")).toBe("google.fr");
		expect(getGoogleDomainForCountry("UK")).toBe("google.co.uk");
		expect(getGoogleDomainForCountry("JP")).toBe("google.co.jp");
		expect(getGoogleDomainForCountry("BR")).toBe("google.com.br");
		expect(getGoogleDomainForCountry("US")).toBe("google.com");
		expect(getGoogleDomainForCountry("zz")).toBe("google.com");
	});

	test("isGoogleDomain matches subdomains", () => {
		expect(isGoogleDomain("foo.bar.gemini.google.com")).toBe(true);
		expect(isGoogleDomain("not.related.example.com")).toBe(false);
	});
});

describe("google/cache", () => {
	test("set/get/delete with TTL", async () => {
		const c = new GoogleCache({ defaultTtlMs: 50, maxEntries: 100 });
		c.set("a", { n: 1 });
		expect(c.get<{ n: number }>("a")).toEqual({ n: 1 });
		c.delete("a");
		expect(c.get("a")).toBeNull();

		c.set("b", "x", 30);
		await Bun.sleep(60);
		expect(c.get("b")).toBeNull();
		c.close();
	});

	test("eviction respects maxEntries", () => {
		const c = new GoogleCache({ maxEntries: 3 });
		c.set("a", 1);
		c.set("b", 2);
		c.set("c", 3);
		c.set("d", 4);
		expect(c.size()).toBe(3);
		expect(c.get("a")).toBeNull();
		c.close();
	});
});

describe("google/rate-limit AdaptiveTokenBucket", () => {
	test("halves on 429 then recovers on 200", () => {
		const b = new AdaptiveTokenBucket({ refillPerSec: 4 });
		b.observe(429);
		expect(b.currentRate).toBeLessThan(4);
		const after429 = b.currentRate;
		b.observe(200);
		expect(b.currentRate).toBeGreaterThan(after429);
	});
});

describe("google/fetch.extractStructuredData", () => {
	test("parses JSON-LD, OpenGraph and meta description", () => {
		const html = `
			<html><head>
				<meta property="og:title" content="Hello" />
				<meta property="og:image" content="https://x/i.png" />
				<meta name="twitter:card" content="summary" />
				<meta name="description" content="A page" />
				<link rel="canonical" href="https://x/canon" />
				<script type="application/ld+json">{"@type":"Article","name":"X"}</script>
				<script type="application/ld+json">[{"@type":"Person","name":"Y"}]</script>
			</head></html>`;
		const out = extractStructuredData(html);
		expect(out.openGraph.title).toBe("Hello");
		expect(out.openGraph.image).toBe("https://x/i.png");
		expect(out.twitter.card).toBe("summary");
		expect(out.description).toBe("A page");
		expect(out.canonical).toBe("https://x/canon");
		expect(out.jsonLd).toHaveLength(2);
	});
});

describe("google/detector enrichments", () => {
	test("identifies reCAPTCHA enterprise + product list", () => {
		const html = `
			<script src="https://www.google.com/recaptcha/enterprise.js"></script>
			<script src="https://www.googletagmanager.com/gtag/js"></script>
			<script>grecaptcha.execute("key", {action: "homepage"})</script>
			<meta gemini="true" />`;
		const det = detectGoogleSpecifics(
			"https://example.com",
			new Headers(),
			html,
		);
		expect(det.hasAntiBot).toBe(true);
		expect(det.antiBotKind).toBe("recaptcha-enterprise");
		expect(det.products).toContain("Google Tag Manager");
		expect(det.products).toContain("Gemini");
	});

	test("detects Cloud Run / Firebase hosting via hostname", () => {
		const det = detectGoogleSpecifics(
			"https://something-uw.a.run.app/",
			new Headers(),
			"<html></html>",
		);
		expect(det.hosting).toBe("cloud-run");
	});
});
