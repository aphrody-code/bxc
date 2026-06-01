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

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { mirrorSite } from "../../src/mirror/mirror.ts";

describe("Site Mirroring Module", () => {
	let server: any;
	let serverUrl: string;
	const outDir = join(import.meta.dir, "../../tmp/mirror-test-out");

	beforeAll(() => {
		// Start a local HTTP server serving a test site
		server = Bun.serve({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/") {
					return new Response(
						`<html>
							<head>
								<link rel="stylesheet" href="/style.css">
							</head>
							<body>
								<h1>Home</h1>
								<a href="/about/">About Us</a>
								<a href="https://other.com/ext">External</a>
							</body>
						</html>`,
						{ headers: { "Content-Type": "text/html" } },
					);
				}
				if (url.pathname === "/about/") {
					return new Response(
						`<html>
							<body>
								<h1>About</h1>
								<a href="/">Home</a>
								<img src="/image.png">
							</body>
						</html>`,
						{ headers: { "Content-Type": "text/html" } },
					);
				}
				if (url.pathname === "/style.css") {
					return new Response(`body { background: url(/bg.jpg); }`, {
						headers: { "Content-Type": "text/css" },
					});
				}
				if (url.pathname === "/bg.jpg" || url.pathname === "/image.png") {
					return new Response(new Uint8Array([1, 2, 3, 4]), {
						headers: { "Content-Type": "image/jpeg" },
					});
				}
				if (url.pathname === "/robots.txt") {
					return new Response(
						`User-agent: *
Sitemap: ${serverUrl}/sitemap.xml`,
						{ headers: { "Content-Type": "text/plain" } },
					);
				}
				if (url.pathname === "/sitemap.xml") {
					return new Response(
						`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
							<url><loc>${serverUrl}/</loc></url>
							<url><loc>${serverUrl}/about/</loc></url>
							<url><loc>${serverUrl}/hidden.html</loc></url>
						</urlset>`,
						{ headers: { "Content-Type": "text/xml" } },
					);
				}
				if (url.pathname === "/hidden.html") {
					return new Response(`<html><body>Hidden page</body></html>`, {
						headers: { "Content-Type": "text/html" },
					});
				}
				return new Response("Not Found", { status: 404 });
			},
		});
		serverUrl = `http://127.0.0.1:${server.port}`;
	});

	afterAll(() => {
		server.stop();
		if (existsSync(outDir)) {
			rmSync(outDir, { recursive: true, force: true });
		}
	});

	test("should perform recursive crawl, asset download, link correction, and gzip sidecars", async () => {
		if (existsSync(outDir)) {
			rmSync(outDir, { recursive: true, force: true });
		}

		const harPath = join(outDir, "session.har");
		const manifest = await mirrorSite(serverUrl, {
			outDir,
			recursive: true,
			maxPages: 10,
			maxDepth: 3,
			compress: true,
			discoverHidden: true,
			har: harPath,
			log: (m) => console.log(m),
		});

		expect(manifest.totalAssets).toBeGreaterThan(3);
		expect(manifest.failed).toBe(0);

		const hostDir = join(outDir, "127.0.0.1");
		expect(existsSync(join(hostDir, "index.html"))).toBe(true);
		expect(existsSync(join(hostDir, "about/index.html"))).toBe(true);
		expect(existsSync(join(hostDir, "hidden.html"))).toBe(true);
		expect(existsSync(join(hostDir, "style.css"))).toBe(true);
		expect(existsSync(join(hostDir, "bg.jpg"))).toBe(true);
		expect(existsSync(join(hostDir, "image.png"))).toBe(true);

		// Verify compression sidecars (.gz files) exist alongside text assets
		expect(existsSync(join(hostDir, "index.html.gz"))).toBe(true);
		expect(existsSync(join(hostDir, "style.css.gz"))).toBe(true);
		// Binary images should NOT be compressed
		expect(existsSync(join(hostDir, "bg.jpg.gz"))).toBe(false);

		// Verify HAR log
		expect(existsSync(harPath)).toBe(true);
		const harJson = JSON.parse(readFileSync(harPath, "utf-8"));
		expect(harJson.log).toBeDefined();
		expect(harJson.log.creator.name).toBe("Bxc");
		expect(harJson.log.pages.length).toBe(1);
		expect(harJson.log.pages[0].title).toContain("Mirror of");
		expect(harJson.log.entries.length).toBeGreaterThan(0);
		const urls = harJson.log.entries.map((e: any) => e.request.url);
		expect(urls).toContain(`${serverUrl}/`);
		expect(urls).toContain(`${serverUrl}/style.css`);

		// Check link rewriting in HTML
		const indexHtml = readFileSync(join(hostDir, "index.html"), "utf-8");
		// Check that stylesheet link has been rewritten
		expect(indexHtml).toContain('href="style.css"');
		// Check that navigation link to about has been rewritten
		expect(indexHtml).toContain('href="about/index.html"');
		// Check that external link remains external
		expect(indexHtml).toContain('href="https://other.com/ext"');

		// Check CSS rewriting
		const styleCss = readFileSync(join(hostDir, "style.css"), "utf-8");
		expect(styleCss).toContain('url("bg.jpg")');
	});

	test("should respect advanced filters: noParent and noHostDirectories", async () => {
		const outDirFiltered = join(
			import.meta.dir,
			"../../tmp/mirror-test-filtered",
		);
		if (existsSync(outDirFiltered)) {
			rmSync(outDirFiltered, { recursive: true, force: true });
		}

		// Crawl starting at "/about/" with noParent = true (should not crawl "/")
		const manifest = await mirrorSite(`${serverUrl}/about/`, {
			outDir: outDirFiltered,
			recursive: true,
			maxPages: 10,
			maxDepth: 3,
			noParent: true,
			noHostDirectories: true,
		});

		expect(manifest.failed).toBe(0);

		// Since noHostDirectories = true, same-origin files are written directly under outDirFiltered/ without host prefix
		// "/about/" maps to "about/index.html"
		expect(existsSync(join(outDirFiltered, "about/index.html"))).toBe(true);

		// The root "/" should NOT be crawled because noParent is true
		expect(existsSync(join(outDirFiltered, "index.html"))).toBe(false);

		// Cleanup
		if (existsSync(outDirFiltered)) {
			rmSync(outDirFiltered, { recursive: true, force: true });
		}
	});

	test("should perform minification and Brotli pre-compression when options are enabled", async () => {
		const outDirMin = join(import.meta.dir, "../../tmp/mirror-test-min");
		if (existsSync(outDirMin)) {
			rmSync(outDirMin, { recursive: true, force: true });
		}

		const manifest = await mirrorSite(serverUrl, {
			outDir: outDirMin,
			recursive: true,
			maxPages: 10,
			maxDepth: 3,
			compress: true,
			minify: true,
		});

		expect(manifest.failed).toBe(0);

		const hostDir = join(outDirMin, "127.0.0.1");

		// Verify Brotli sidecar exists
		expect(existsSync(join(hostDir, "index.html.br"))).toBe(true);
		expect(existsSync(join(hostDir, "style.css.br"))).toBe(true);

		// Verify minification actually happened (comments removed, spaces collapsed)
		const indexHtml = readFileSync(join(hostDir, "index.html"), "utf-8");
		expect(indexHtml).not.toContain("<!--");

		const styleCss = readFileSync(join(hostDir, "style.css"), "utf-8");
		expect(styleCss).toContain("body{background:url("); // punctuation spacing removed

		// Cleanup
		if (existsSync(outDirMin)) {
			rmSync(outDirMin, { recursive: true, force: true });
		}
	});
});
