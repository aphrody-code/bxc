import { Actor } from "../../sdk/Actor.ts";
import { Browser } from "../../api/browser.ts";
import { googleWebSearch } from "../../google/search.ts";
import { htmlToMarkdown } from "../../internal/html-utils.ts";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import pLimit from "p-limit";

// URL interpreter matching Apify utility behavior
function interpretAsUrl(input: string): string | null {
	if (!input) return null;
	function tryValid(s: string): string | null {
		try {
			const url = new URL(s);
			return /^https?:/i.test(url.protocol) ? url.href : null;
		} catch {
			return null;
		}
	}
	let candidate = input;
	for (let i = 0; i < 3; i++) {
		const result = tryValid(candidate);
		if (result) return result;
		try {
			candidate = decodeURIComponent(candidate);
		} catch {
			break;
		}
	}
	return null;
}

interface ScraperOptions {
	query: string;
	urls?: string[];
	maxResults?: number;
	outputFormats?: string[];
	outputFormat?: string;
	scrapingTool?: "browser-playwright" | "raw-http";
	dynamicContent?: boolean;
	removeElementsCssSelector?: string;
	removeElements?: string;
	htmlTransformer?: string;
	desiredConcurrency?: number;
	maxRequestRetries?: number;
	dynamicContentWaitSecs?: number;
	removeCookieWarnings?: boolean;
	debugMode?: boolean;
}

// Reusable scraper runner
async function runScraper(options: ScraperOptions) {
	const query = options.query;
	const maxResults = options.maxResults ?? 3;
	const outputFormats: string[] = options.outputFormats
		? options.outputFormats
		: (options.outputFormat ? [options.outputFormat] : ["markdown"]);
	const scrapingTool = options.scrapingTool
		? options.scrapingTool
		: (options.dynamicContent ? "browser-playwright" : "raw-http");
	const removeElementsCssSelector = options.removeElementsCssSelector !== undefined
		? options.removeElementsCssSelector
		: (options.removeElements !== undefined
			? options.removeElements
			: "nav, footer, script, style, noscript, svg, img[src^='data:'], [role=\"alert\"], [role=\"banner\"], [role=\"dialog\"], [role=\"alertdialog\"], [role=\"region\"][aria-label*=\"skip\" i], [aria-modal=\"true\"]");
	const htmlTransformer = options.htmlTransformer ?? "none";
	const desiredConcurrency = options.desiredConcurrency ?? 5;
	const dynamicContentWaitSecs = options.dynamicContentWaitSecs ?? 10;
	const removeCookieWarnings = options.removeCookieWarnings ?? true;
	const debugMode = options.debugMode ?? false;

	const isUrl = interpretAsUrl(query);
	let targetUrls: string[] = [];
	const searchResultsMeta = new Map<string, { rank: number; title?: string; description?: string }>();

	if (isUrl) {
		targetUrls = [isUrl];
		searchResultsMeta.set(isUrl, { rank: 1, title: "", description: "" });
	} else {
		console.log(`[RAG-Browser] Performing Google search for query: "${query}"`);
		try {
			const results = await googleWebSearch(query, { num: maxResults });
			console.log(`[RAG-Browser] Search returned ${results.length} results.`);
			for (let i = 0; i < results.length; i++) {
				const res = results[i];
				if (targetUrls.length < maxResults) {
					targetUrls.push(res.url);
					searchResultsMeta.set(res.url, {
						rank: i + 1,
						title: res.title,
						description: res.snippet
					});
				}
			}
		} catch (err) {
			console.error(`[RAG-Browser] Search failed:`, err);
		}
	}

	// Merge with options.urls if provided (Bxc extension)
	if (options.urls && options.urls.length > 0) {
		for (const u of options.urls) {
			const normalized = interpretAsUrl(u);
			if (normalized && !targetUrls.includes(normalized)) {
				targetUrls.push(normalized);
				searchResultsMeta.set(normalized, { rank: targetUrls.length, title: "", description: "" });
			}
		}
	}

	if (targetUrls.length === 0) {
		return [];
	}

	console.log(`[RAG-Browser] Crawling ${targetUrls.length} pages (concurrency: ${desiredConcurrency})...`);

	const limit = pLimit(desiredConcurrency);
	const promises = targetUrls.map((url) => {
		return limit(async () => {
			const createdAt = new Date();
			const searchMeta = searchResultsMeta.get(url) || { rank: 1, title: "", description: "" };
			const timeMeasures: any[] = [];
			const startMs = Date.now();

			const addTimeMeasure = (event: string) => {
				const timeMs = Date.now();
				const prev = timeMeasures.length > 0 ? timeMeasures[timeMeasures.length - 1].timeMs : startMs;
				timeMeasures.push({
					event,
					timeMs,
					timeDeltaPrevMs: timeMs - prev
				});
			};

			addTimeMeasure("request-start");

			// Choose profile mapping
			// Cheerio maps to static/http profiles in Bxc. We use "static" in Bxc for Cheerio equivalent since we can manipulate DOM tree.
			const profile = scrapingTool === "browser-playwright" ? "stealth" : "static";

			let page: any = null;
			try {
				page = await Browser.newPage({ profile });
				addTimeMeasure("page-created");

				await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
				addTimeMeasure("page-loaded");

				if (scrapingTool === "browser-playwright" && dynamicContentWaitSecs > 0) {
					// Wait for dynamic content
					await new Promise((resolve) => setTimeout(resolve, dynamicContentWaitSecs * 1000));
					addTimeMeasure("dynamic-content-wait");
				}

				if (removeCookieWarnings && page.evaluate) {
					// close consent alerts / cookie walls
					await page.evaluate(() => {
						try {
							const selectors = [
								"#cookie-banner", ".cookie-banner", "#consent-banner",
								"[id*='cookie' i]", "[class*='cookie' i]", "[id*='consent' i]"
							];
							for (const selector of selectors) {
								const elements = document.querySelectorAll(selector);
								for (const el of Array.from(elements)) {
									(el as HTMLElement).style.display = "none";
								}
							}
						} catch {}
					});
					addTimeMeasure("cookie-warnings-closed");
				}

				if (removeElementsCssSelector && page.evaluate) {
					await page.evaluate((selector: string) => {
						try {
							const nodes = document.querySelectorAll(selector);
							for (const node of Array.from(nodes)) {
								node.remove();
							}
						} catch {}
					}, removeElementsCssSelector);
					addTimeMeasure("elements-removed");
				}

				let html = await page.content();
				addTimeMeasure("content-retrieved");

				// Extract metadata using JSDOM
				const dom = new JSDOM(html, { url });
				const title = dom.window.document.title || "";
				const desc = dom.window.document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
				const auth = dom.window.document.querySelector('meta[name="author"]')?.getAttribute("content") || "";
				const lang = dom.window.document.documentElement.getAttribute("lang") || "";

				// Apply Mozilla Readability transformation if requested
				if (htmlTransformer === "readableText") {
					const reader = new Readability(dom.window.document);
					const parsed = reader.parse();
					if (parsed) {
						html = parsed.content;
						if (parsed.title) {
							html = `<h1>${parsed.title}</h1>\n${html}`;
						}
					}
					addTimeMeasure("readability-applied");
				}

				// Extract requested formats
				let markdown: string | null = null;
				if (outputFormats.includes("markdown")) {
					markdown = htmlToMarkdown(html);
					addTimeMeasure("markdown-converted");
				}

				let text: string | null = null;
				if (outputFormats.includes("text")) {
					text = dom.window.document.body.textContent || dom.window.document.body.innerText || "";
					addTimeMeasure("text-extracted");
				}

				await page.close();
				addTimeMeasure("page-closed");

				const loadedAt = new Date();
				const relativeTimeMeasures = timeMeasures.map(tm => ({
					event: tm.event,
					timeMs: tm.timeMs - startMs,
					timeDeltaPrevMs: tm.timeDeltaPrevMs
				}));

				return {
					markdown,
					html: outputFormats.includes("html") ? html : undefined,
					text,
					query,
					crawl: {
						createdAt,
						loadedAt,
						httpStatusCode: 200,
						httpStatusMessage: "OK",
						requestStatus: "handled",
						uniqueKey: url,
						debug: debugMode ? { timeMeasures: relativeTimeMeasures } : undefined
					},
					searchResult: {
						title: searchMeta.title,
						url,
						description: searchMeta.description,
						rank: searchMeta.rank
					},
					metadata: {
						title,
						url,
						redirectedUrl: url,
						description: desc,
						author: auth,
						languageCode: lang
					}
				};
			} catch (err: any) {
				console.error(`[RAG-Browser] Failed to scrape ${url}:`, err);
				if (page) {
					try { await page.close(); } catch {}
				}
				return {
					crawl: {
						createdAt,
						loadedAt: new Date(),
						httpStatusCode: 500,
						httpStatusMessage: err.message,
						requestStatus: "failed",
						uniqueKey: url
					},
					searchResult: {
						title: searchMeta.title,
						url,
						description: searchMeta.description,
						rank: searchMeta.rank
					},
					metadata: {
						url
					}
				};
			}
		});
	});

	return Promise.all(promises);
}

// Standby Mode detection
const isStandby =
	process.env.APIFY_META_ORIGIN === "STANDBY" ||
	process.env.ACTOR_META_ORIGIN === "STANDBY" ||
	process.env.STANDBY_MODE === "1";

if (isStandby) {
	const port = Number(
		process.env.APIFY_CONTAINER_PORT ||
		process.env.ACTOR_STANDBY_PORT ||
		3000
	);
	console.log(`[RAG-Browser] Starting Standby server on port ${port}...`);

	Bun.serve({
		port,
		async fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/") {
				return Response.json({
					message: `Actor is running in Standby mode. Send a GET request to /search?query=hello+world`
				});
			}

			if (url.pathname === "/search") {
				const query = url.searchParams.get("query");
				if (!query) {
					return Response.json({ error: "Missing required 'query' parameter" }, { status: 400 });
				}

				const maxResults = Number(url.searchParams.get("maxResults") || "3");
				const scrapingTool = url.searchParams.get("scrapingTool") || "raw-http";
				const htmlTransformer = url.searchParams.get("htmlTransformer") || "none";
				const formatsStr = url.searchParams.get("outputFormats") || url.searchParams.get("outputFormat") || "markdown";
				const outputFormats = formatsStr.split(",").map(f => f.trim());
				const removeElementsCssSelector = url.searchParams.get("removeElementsCssSelector") || undefined;
				const dynamicContentWaitSecs = Number(url.searchParams.get("dynamicContentWaitSecs") || "10");
				const removeCookieWarnings = url.searchParams.get("removeCookieWarnings") !== "false";
				const debugMode = url.searchParams.get("debugMode") === "true";

				try {
					const results = await runScraper({
						query,
						maxResults,
						scrapingTool: scrapingTool as any,
						htmlTransformer,
						outputFormats,
						removeElementsCssSelector,
						dynamicContentWaitSecs,
						removeCookieWarnings,
						debugMode
					});
					return Response.json(results);
				} catch (err: any) {
					return Response.json({ error: err.message }, { status: 500 });
				}
			}

			return Response.json({ error: "Not Found" }, { status: 404 });
		}
	});

	// Keep standby process alive indefinitely
	await new Promise(() => {});
} else {
	// Normal Actor execution mode
	await Actor.main(async () => {
		const input = await Actor.getInput<ScraperOptions>() || {} as ScraperOptions;
		if (!input.query) {
			throw new Error("Missing 'query' field in input JSON.");
		}

		const results = await runScraper(input);

		// Push detailed dataset results
		await Actor.pushData(results);

		// Store combined output string for KVS
		const outputFormats = input.outputFormats || (input.outputFormat ? [input.outputFormat] : ["markdown"]);
		if (outputFormats.includes("json") || input.outputFormat === "json") {
			await Actor.setValue("OUTPUT", results);
		} else {
			let combinedOutput = "";
			for (const item of results) {
				if (item.crawl.requestStatus === "handled") {
					const content = item.markdown || item.text || item.html || "";
					combinedOutput += `\n\n--- \nSource: ${item.metadata.url}\nTitle: ${item.metadata.title}\n---\n\n${content}\n`;
				}
			}
			await Actor.setValue("OUTPUT", combinedOutput.trim());
		}

		console.log(`[RAG-Browser] Normal run completed. Scraped ${results.length} pages.`);
	});
}
