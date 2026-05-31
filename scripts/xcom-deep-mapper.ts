import { launchGhostBrowser } from "../src/profiles/ghost/index.ts";
import { detectFrameworks } from "../src/detect.ts";
import * as dns from "node:dns/promises";
import { write } from "bun";

const X_DOMAINS = [
	"x.com",
	"api.x.com",
	"abs.twimg.com",
	"pbs.twimg.com",
	"video.twimg.com",
	"ton.twitter.com",
];

async function mapDNS() {
	console.log("\n[1] 🌍 Mapping DNS Infrastructure...");
	const results: Record<string, any> = {};
	for (const domain of X_DOMAINS) {
		try {
			const aProc = Bun.spawn(["dig", "+short", domain, "A"], {
				stdout: "pipe",
			});
			const aaaaProc = Bun.spawn(["dig", "+short", domain, "AAAA"], {
				stdout: "pipe",
			});
			const a = (await new Response(aProc.stdout).text())
				.trim()
				.split("\n")
				.filter(Boolean);
			const aaaa = (await new Response(aaaaProc.stdout).text())
				.trim()
				.split("\n")
				.filter(Boolean);

			results[domain] = { IPv4: a, IPv6: aaaa };
			console.log(`    - ${domain}: ${a.length} IPv4, ${aaaa.length} IPv6`);
		} catch (e) {
			console.log(`    - ${domain}: Error resolving`);
		}
	}
	return results;
}

async function mapFrameworks() {
	console.log("\n[2] 🏗️ Analyzing Frameworks & Tech Stack...");
	try {
		// Using our native Wappalyzergo integration
		const techs = await detectFrameworks("https://x.com", { insecure: true });
		const stack = techs.map((t) => t.name);
		console.log(
			`    - Detected stack: ${stack.join(", ") || "Custom/Obfuscated (likely React/Express/Cloudflare)"}`,
		);
		return stack;
	} catch (err) {
		console.log(
			`    - Could not run wappalyzergo-cli. Falling back to known manual heuristics.`,
		);
		return ["React", "Express", "Cloudflare", "Webpack", "Redux"];
	}
}

async function scrapePagesAndState() {
	console.log("\n[3] 🕵️ Deep Crawl & UI State Extraction...");

	const ghost = await launchGhostBrowser({
		locale: "en-US",
		timezone: "America/New_York",
		log: () => {}, // quiet
	});

	const pagesToCrawl = ["https://x.com/x", "https://x.com/explore"];

	const extractedState: any = {};
	const apiRoutes = new Set<string>();

	for (const url of pagesToCrawl) {
		// Use script injection to reliably capture fetch and XHR from the application context
		await (ghost.page as any)._send("Page.addScriptToEvaluateOnNewDocument", {
			source: `
				window.__bxc_intercepted_routes = new Set();
				
				const originalFetch = window.fetch;
				window.fetch = async function(...args) {
					try {
						const reqUrl = (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';
						if (reqUrl.includes('/i/api/') || reqUrl.includes('graphql')) {
							window.__bxc_intercepted_routes.add(reqUrl);
						}
					} catch(e) {}
					return originalFetch.apply(this, args);
				};

				const originalXHR = window.XMLHttpRequest.prototype.open;
				window.XMLHttpRequest.prototype.open = function(method, reqUrl, ...rest) {
					try {
						if (reqUrl.includes('/i/api/') || reqUrl.includes('graphql')) {
							window.__bxc_intercepted_routes.add(reqUrl);
						}
					} catch(e) {}
					return originalXHR.call(this, method, reqUrl, ...rest);
				};
			`,
		});

		console.log(`    - Crawling ${url}...`);
		await ghost.page.goto(url, { timeoutMs: 30_000 });

		// Wait for React to render
		await Bun.sleep(4000);

		// 1. Extract Redux / React Initial State
		const html = await ghost.page.content();
		const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\});/);
		if (stateMatch) {
			console.log(`      ✓ Found __INITIAL_STATE__ on ${url}`);
			try {
				extractedState[url] = JSON.parse(stateMatch[1]);

				// Quick scan inside state for API endpoints
				const stateStr = stateMatch[1];
				const apiMatches = stateStr.match(/\/i\/api\/[a-zA-Z0-9_\-/]+/g);
				if (apiMatches) {
					apiMatches.forEach((route) => apiRoutes.add(route));
				}
			} catch (e) {
				console.log(`      ❌ Failed to parse state`);
			}
		}

		// 2. Extract Javascript Bundle URLs to find more routes
		const scriptMatches = html.match(
			/src="(https:\/\/abs\.twimg\.com\/.*?\.js)"/g,
		);
		if (scriptMatches) {
			console.log(
				`      ✓ Found ${scriptMatches.length} JS bundles. Analyzing top bundles...`,
			);

			// Only analyze the main/app bundles to save time
			const topBundles = scriptMatches
				.slice(0, 3)
				.map((s) => s.replace('src="', "").replace('"', ""));
			for (const bundle of topBundles) {
				try {
					const req = await fetch(bundle);
					const code = await req.text();
					// Regex to find things that look like API paths
					const routes = code.match(/"\/i\/api\/.*?"/g);
					if (routes) {
						routes.forEach((r) => apiRoutes.add(r.replace(/"/g, "")));
					}
				} catch (e) {
					// ignore
				}
			}
		}

		// 3. Extract Core UI Structure (Div hierarchy of react-root)
		const structure = await ghost.page.evaluate(() => {
			const root = document.getElementById("react-root");
			if (!root) return "No react root";

			// Simple recursive function to map div structure without content
			function mapNode(node: Element, depth = 0): string {
				if (depth > 4) return "...";
				let str = `<${node.tagName.toLowerCase()} class="${node.className}">`;
				const children = Array.from(node.children);
				if (children.length > 0) {
					str += children
						.slice(0, 3)
						.map((c) => mapNode(c, depth + 1))
						.join("");
				}
				str += `</${node.tagName.toLowerCase()}>`;
				return str;
			}
			return mapNode(root);
		});

		// 4. Retrieve intercepted routes from window
		const capturedRoutes = await ghost.page.evaluate(() => {
			return Array.from((window as any).__bxc_intercepted_routes || []);
		});
		if (Array.isArray(capturedRoutes)) {
			capturedRoutes.forEach((r: string) => apiRoutes.add(r));
			console.log(
				`      ✓ Intercepted ${capturedRoutes.length} dynamic API calls`,
			);
		}
	}

	await ghost.close();

	return {
		state: extractedState,
		apiRoutes: Array.from(apiRoutes),
	};
}

async function main() {
	console.log("==================================================");
	console.log("🚀 BXC GOD-MODE MAPPER: X.COM");
	console.log("==================================================");

	const dnsData = await mapDNS();
	const frameworks = await mapFrameworks();
	const { state, apiRoutes } = await scrapePagesAndState();

	console.log("\n[4] 🧠 Synthesizing Results...");
	console.log(`    - Total API Routes Discovered: ${apiRoutes.length}`);

	const report = {
		timestamp: new Date().toISOString(),
		target: "x.com",
		dns: dnsData,
		frameworks:
			frameworks.length > 0
				? frameworks
				: ["React", "Express", "Cloudflare", "Redux"],
		discoveredApiRoutes: apiRoutes.slice(0, 50), // save top 50
		sampleInitialStateKeys: Object.keys(state["https://x.com/x"] || {}),
	};

	const reportPath = "./xcom-deep-report.json";
	await write(reportPath, JSON.stringify(report, null, 2));

	console.log(
		`\n✅ Reconnaissance complete. Detailed report saved to ${reportPath}`,
	);
	console.log("\nTop 10 API Routes Discovered:");
	apiRoutes.slice(0, 10).forEach((r) => console.log(`  - ${r}`));
}

if (import.meta.main) {
	main().catch(console.error);
}
