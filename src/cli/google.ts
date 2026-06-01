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
 * bxc google <action> <arg> — Google Ecosystem client, keyless APIs, & Gemini Web
 */

import { GoogleClient } from "../google/client.ts";
import { EXIT, type CommonOptions, logger } from "./shared.ts";
import { KeylessGoogleClient } from "../google/keyless.ts";
import { GeminiWebClient } from "../google/gemini-web.ts";
import { GeminiScraper } from "../google/gemini-scraper.ts";
import { join } from "node:path";
import readline from "node:readline";

function printUsage(): void {
	Bun.stdout.write(
		`bxc google — Google Ecosystem client & auditor (mandate compliant)

Usage:
  bxc google search <query>          Perform a search on Google Web
  bxc google open <url>              Visit a Google domain with mandate guard & audit
  bxc google audit <urls...>         Perform a massive concurrent audit on Google pages

  # Keyless & Anonymous Google APIs
  bxc google dns <name> [type]       Query Google Public DNS-over-HTTPS (default type: A)
  bxc google books <query>           Search the public Google Books catalog
  bxc google book <volume_id>        Retrieve a specific Google Book volume metadata
  bxc google translate <text>        Translate text (default: target=en, source=auto)
  bxc google suggest <query>         Get autocomplete search query suggestions
  bxc google calendar <cal_id>       Fetch and parse events from public Google iCal feed
  bxc google sheet <id> [gid]        Export a public Google Sheet to CSV
  bxc google doc <id>                Export a public Google Doc to plain text
  bxc google download <id> <out>     Download a public Google Drive file by ID

  # Gemini Web (Cookie-based chat UI)
  bxc google chat [prompt]           Interact with Gemini Web client (interactive REPL if no prompt)
  bxc google conversations           List recent conversation history
  bxc google resume <cid> [prompt]   Resume a conversation by conversation ID
  bxc google delete <cid>            Delete a conversation by ID
  bxc google scrape                  Scrape & analyze static code/RPCs of Gemini Web App
  bxc google auto-upgrade            Run the autonomous scraping and upgrade loop for Gemini Web Client

Options:
  --profile <name>     stealth (default) | static | max
  --type <type>        DNS query type (A, AAAA, MX, TXT, etc.)
  --max-results <n>    Max results for books search (default: 10)
  --start <n>          Start index for books search (default: 0)
  --target <lang>      Translate target language code (default: en)
  --source <lang>      Translate source language code (default: auto)
  --client <name>      Autocomplete client ID (default: chrome)
  --cid <id>           Conversation ID for chat
  --rid <id>           Response ID for chat
  --rcid <id>          Candidate response ID for chat
  --thread             Return JSON metadata with reply and conversation IDs
  --repl               Force entering REPL in chat / resume
  --model <model>      Select Gemini model (flash, flash-lite, pro) (default: flash)
  --out <file>         Save scrape report to Markdown file
  --json-out <file>    Save scrape data to JSON file
  --help, -h           this help

`,
	);
}

function parseArgs(argv: readonly string[]) {
	const positional: string[] = [];
	const flags: Record<string, string | boolean> = {};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const eqIdx = arg.indexOf("=");
			if (eqIdx !== -1) {
				const key = arg.slice(2, eqIdx);
				const val = arg.slice(eqIdx + 1);
				flags[key] = val === "true" ? true : val === "false" ? false : val;
			} else {
				const key = arg.slice(2);
				if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
					const nextVal = argv[i + 1];
					flags[key] = nextVal === "true" ? true : nextVal === "false" ? false : nextVal;
					i++;
				} else {
					flags[key] = true;
				}
			}
		} else if (arg.startsWith("-")) {
			const key = arg.slice(1);
			if (key === "h") {
				flags["help"] = true;
			} else {
				flags[key] = true;
			}
		} else {
			positional.push(arg);
		}
	}

	return { positional, flags };
}

export async function main(
	argv: readonly string[],
	baseOpts: CommonOptions,
): Promise<void> {
	const { positional, flags } = parseArgs(argv);
	const action = positional[0];

	if (!action || flags["help"] || flags["h"]) {
		printUsage();
		process.exit(action ? 0 : EXIT.MISUSE);
	}

	try {
		switch (action) {
			case "search": {
				const query = positional.slice(1).join(" ");
				if (!query) {
					logger.error("search <query> — missing query argument");
					process.exit(EXIT.MISUSE);
				}
				const client = new GoogleClient({
					profile: (flags["profile"] as any) || "stealth",
					proxy: baseOpts.proxy,
				});
				const results = await client.search(query);
				Bun.stdout.write(JSON.stringify(results, null, 2) + "\n");
				break;
			}

			case "open": {
				const targetUrl = positional[1];
				if (!targetUrl) {
					logger.error("open <url> — missing URL argument");
					process.exit(EXIT.MISUSE);
				}
				const client = new GoogleClient({
					profile: (flags["profile"] as any) || "stealth",
					proxy: baseOpts.proxy,
				});
				const { page, audit } = await client.open(targetUrl);
				try {
					const title = await page.title();
					const content = await page.content();
					Bun.stdout.write(
						JSON.stringify(
							{
								url: targetUrl,
								title,
								htmlLength: content.length,
								audit,
							},
							null,
							2,
						) + "\n",
					);
				} finally {
					await page.close().catch(() => {});
				}
				break;
			}

			case "audit": {
				const seeds = positional.slice(1);
				if (seeds.length === 0) {
					logger.error("audit <urls...> — missing seed URL arguments");
					process.exit(EXIT.MISUSE);
				}
				const client = new GoogleClient({
					profile: (flags["profile"] as any) || "stealth",
					proxy: baseOpts.proxy,
				});
				const results = await client.auditMassive(seeds);
				Bun.stdout.write(JSON.stringify(results, null, 2) + "\n");
				break;
			}

			case "dns": {
				const name = positional[1];
				if (!name) {
					logger.error("dns <name> [type] — missing name argument");
					process.exit(EXIT.MISUSE);
				}
				const type = (flags["type"] as string) || positional[2] || "A";
				const client = new KeylessGoogleClient();
				const res = await client.resolveDns(name, type);
				Bun.stdout.write(JSON.stringify(res, null, 2) + "\n");
				break;
			}

			case "books": {
				const query = positional.slice(1).join(" ");
				if (!query) {
					logger.error("books <query> — missing query argument");
					process.exit(EXIT.MISUSE);
				}
				const maxResults = Number(flags["max-results"]) || 10;
				const start = Number(flags["start"]) || 0;
				const client = new KeylessGoogleClient();
				const res = await client.searchBooks(query, maxResults, start);
				Bun.stdout.write(JSON.stringify(res, null, 2) + "\n");
				break;
			}

			case "book": {
				const volumeId = positional[1];
				if (!volumeId) {
					logger.error("book <volume_id> — missing volume_id argument");
					process.exit(EXIT.MISUSE);
				}
				const client = new KeylessGoogleClient();
				const res = await client.getBook(volumeId);
				Bun.stdout.write(JSON.stringify(res, null, 2) + "\n");
				break;
			}

			case "translate": {
				const text = positional.slice(1).join(" ");
				if (!text) {
					logger.error("translate <text> — missing text argument");
					process.exit(EXIT.MISUSE);
				}
				const target = (flags["target"] as string) || "en";
				const source = (flags["source"] as string) || "auto";
				const client = new KeylessGoogleClient();
				const res = await client.translate(text, target, source);
				Bun.stdout.write(JSON.stringify(res) + "\n");
				break;
			}

			case "suggest": {
				const query = positional.slice(1).join(" ");
				if (!query) {
					logger.error("suggest <query> — missing query argument");
					process.exit(EXIT.MISUSE);
				}
				const autocompleteClient = (flags["client"] as string) || "chrome";
				const client = new KeylessGoogleClient();
				const res = await client.autocomplete(query, autocompleteClient);
				Bun.stdout.write(JSON.stringify(res) + "\n");
				break;
			}

			case "calendar": {
				const calendarId = positional[1];
				if (!calendarId) {
					logger.error("calendar <calendar_id> — missing calendar_id argument");
					process.exit(EXIT.MISUSE);
				}
				const client = new KeylessGoogleClient();
				const res = await client.getPublicCalendarEvents(calendarId);
				Bun.stdout.write(JSON.stringify(res, null, 2) + "\n");
				break;
			}

			case "sheet": {
				const spreadsheetId = positional[1];
				if (!spreadsheetId) {
					logger.error("sheet <spreadsheet_id> [gid] — missing spreadsheet_id argument");
					process.exit(EXIT.MISUSE);
				}
				const gid = (flags["gid"] as string) || positional[2] || undefined;
				const client = new KeylessGoogleClient();
				const res = await client.exportPublicSheetToCsv(spreadsheetId, gid);
				Bun.stdout.write(res + "\n");
				break;
			}

			case "doc": {
				const documentId = positional[1];
				if (!documentId) {
					logger.error("doc <document_id> — missing document_id argument");
					process.exit(EXIT.MISUSE);
				}
				const client = new KeylessGoogleClient();
				const res = await client.exportPublicDocToText(documentId);
				Bun.stdout.write(res + "\n");
				break;
			}

			case "download": {
				const fileId = positional[1];
				const dest = positional[2];
				if (!fileId || !dest) {
					logger.error("download <file_id> <out> — missing arguments");
					process.exit(EXIT.MISUSE);
				}
				const client = new KeylessGoogleClient();
				const res = await client.downloadPublicDriveFile(fileId);
				await Bun.write(dest, res);
				Bun.stdout.write(JSON.stringify({ saved: dest, bytes: res.length }, null, 2) + "\n");
				break;
			}

			case "chat": {
				const prompt = positional.slice(1).join(" ");
				const cid = (flags["cid"] as string) || undefined;
				const rid = (flags["rid"] as string) || undefined;
				const rcid = (flags["rcid"] as string) || undefined;
				const thread = !!flags["thread"];
				const repl = !!flags["repl"];
				const model = (flags["model"] as string) || "flash";

				const client = new GeminiWebClient({ model });
				await client.init();
				if (cid) {
					client.resume(cid, rid, rcid);
				}

				if (prompt && !repl) {
					if (thread) {
						const reply = await client.generate(prompt, { keepContext: true });
						const [cidOut, ridOut, rcidOut] = client.conversation;
						Bun.stdout.write(
							JSON.stringify(
								{
									reply,
									title: client.lastTitle,
									conversation: {
										cid: cidOut,
										rid: ridOut,
										rcid: rcidOut,
									},
								},
								null,
								2,
							) + "\n",
						);
					} else {
						const reply = await client.generate(prompt, { keepContext: false });
						Bun.stdout.write(JSON.stringify(reply) + "\n");
					}
					return;
				}

				// Interactive REPL
				console.log("Starting interactive Gemini Web session. Type 'exit' or 'quit' to end.");
				if (client.lastTitle) {
					console.log(`Resumed thread: ${client.lastTitle}`);
				} else if (cid) {
					console.log(`Resumed thread ID: ${cid}`);
				}

				if (prompt && repl) {
					process.stdout.write("Gemini: ");
					const reply = await client.generate(prompt, { keepContext: true });
					console.log(reply);
				}

				const rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
				});

				const askQuestion = () => {
					rl.question("\nYou: ", async (input) => {
						const trimmed = input.trim();
						if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
							rl.close();
							return;
						}
						if (!trimmed) {
							askQuestion();
							return;
						}
						process.stdout.write("Gemini: ");
						try {
							const reply = await client.generate(trimmed, { keepContext: true });
							console.log(reply);
						} catch (err) {
							console.error("\nError:", err instanceof Error ? err.message : String(err));
						}
						askQuestion();
					});
				};
				askQuestion();
				break;
			}

			case "conversations": {
				const model = (flags["model"] as string) || "flash";
				const client = new GeminiWebClient({ model });
				await client.init();
				const history = await client.listConversations();
				Bun.stdout.write(JSON.stringify(history, null, 2) + "\n");
				break;
			}

			case "resume": {
				const cid = positional[1];
				if (!cid) {
					logger.error("resume <cid> [prompt] — missing conversation ID");
					process.exit(EXIT.MISUSE);
				}
				const prompt = positional.slice(2).join(" ");
				const rid = (flags["rid"] as string) || undefined;
				const rcid = (flags["rcid"] as string) || undefined;
				const thread = !!flags["thread"];
				const repl = !!flags["repl"];
				const model = (flags["model"] as string) || "flash";

				const client = new GeminiWebClient({ model });
				await client.init();
				client.resume(cid, rid, rcid);

				if (prompt && !repl) {
					if (thread) {
						const reply = await client.generate(prompt, { keepContext: true });
						const [cidOut, ridOut, rcidOut] = client.conversation;
						Bun.stdout.write(
							JSON.stringify(
								{
									reply,
									title: client.lastTitle,
									conversation: {
										cid: cidOut,
										rid: ridOut,
										rcid: rcidOut,
									},
								},
								null,
								2,
							) + "\n",
						);
					} else {
						const reply = await client.generate(prompt, { keepContext: false });
						Bun.stdout.write(JSON.stringify(reply) + "\n");
					}
					return;
				}

				// Interactive REPL
				console.log("Starting interactive Gemini Web session. Type 'exit' or 'quit' to end.");
				if (client.lastTitle) {
					console.log(`Resumed thread: ${client.lastTitle}`);
				} else {
					console.log(`Resumed thread ID: ${cid}`);
				}

				if (prompt && repl) {
					process.stdout.write("Gemini: ");
					const reply = await client.generate(prompt, { keepContext: true });
					console.log(reply);
				}

				const rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
				});

				const askQuestion = () => {
					rl.question("\nYou: ", async (input) => {
						const trimmed = input.trim();
						if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
							rl.close();
							return;
						}
						if (!trimmed) {
							askQuestion();
							return;
						}
						process.stdout.write("Gemini: ");
						try {
							const reply = await client.generate(trimmed, { keepContext: true });
							console.log(reply);
						} catch (err) {
							console.error("\nError:", err instanceof Error ? err.message : String(err));
						}
						askQuestion();
					});
				};
				askQuestion();
				break;
			}

			case "delete": {
				const cid = positional[1];
				if (!cid) {
					logger.error("delete <cid> — missing conversation ID");
					process.exit(EXIT.MISUSE);
				}
				const model = (flags["model"] as string) || "flash";
				const client = new GeminiWebClient({ model });
				await client.init();
				await client.deleteConversation(cid);
				Bun.stdout.write(JSON.stringify({ deleted: cid }, null, 2) + "\n");
				break;
			}

			case "scrape": {
				const out = flags["out"] as string;
				const jsonOut = flags["json-out"] as string;
				const scraper = new GeminiScraper();
				const data = await scraper.scrape();

				if (jsonOut) {
					await Bun.write(jsonOut, JSON.stringify(data, null, 2));
				}
				const reportMd = scraper.formatMarkdownReport(data);
				if (out) {
					await Bun.write(out, reportMd);
				}

				Bun.stdout.write(
					JSON.stringify(
						{
							script_bundles_count: data.script_urls.length,
							css_classes_count: data.css_classes.length,
							css_variables_count: data.css_variables.length,
							rpc_services_count: data.rpc_services.length,
							rpc_methods_count: data.rpc_methods.length,
							rpc_mappings_count: Object.keys(data.rpc_mappings).length,
							boq_hashes_count: data.boq_hashes.length,
							buttons_count: data.buttons.length,
							models_found: data.models,
							markdown_saved_to: out || null,
							json_saved_to: jsonOut || null,
						},
						null,
						2,
					) + "\n",
				);
				break;
			}

			case "auto-upgrade": {
				logger.log("Initializing static code crawler for Gemini App...");
				const scraper = new GeminiScraper();
				const data = await scraper.scrape();

				const clientFile = join(process.cwd(), "src/google/gemini-web.ts");
				const originalCode = await Bun.file(clientFile).text();

				let listHash: string | null = null;
				let deleteHash: string | null = null;
				for (const [h, m] of Object.entries(data.rpc_mappings)) {
					if (m === "BardFrontendService.ListConversations") {
						listHash = h;
					} else if (m === "BardFrontendService.DeleteConversation") {
						deleteHash = h;
					}
				}

				const listBlockMatch = originalCode.match(
					/async listConversations\(\): Promise<ConversationHistory\[\]> \{([\s\S]*?)\}/,
				);
				const deleteBlockMatch = originalCode.match(
					/async deleteConversation\(cid: string\): Promise<void> \{([\s\S]*?)\}/,
				);

				let currentListHash = "MaZiqc";
				let currentDeleteHash = "GzXR5e";

				if (listBlockMatch) {
					const hashMatch = listBlockMatch[1].match(/"([A-Za-z0-9_]{5,6})"/);
					if (hashMatch) currentListHash = hashMatch[1];
				}
				if (deleteBlockMatch) {
					const hashMatch = deleteBlockMatch[1].match(/"([A-Za-z0-9_]{5,6})"/);
					if (hashMatch) currentDeleteHash = hashMatch[1];
				}

				let updatedCode = originalCode;
				const replacements = [];

				if (listHash && listHash !== currentListHash) {
					logger.log(`Detected new ListConversations hash: ${listHash}`);
					updatedCode = updatedCode.replace(new RegExp(`"${currentListHash}"`, "g"), `"${listHash}"`);
					replacements.push({ target: currentListHash, replacement: listHash });
				}
				if (deleteHash && deleteHash !== currentDeleteHash) {
					logger.log(`Detected new DeleteConversation hash: ${deleteHash}`);
					updatedCode = updatedCode.replace(new RegExp(`"${currentDeleteHash}"`, "g"), `"${deleteHash}"`);
					replacements.push({ target: currentDeleteHash, replacement: deleteHash });
				}

				if (replacements.length > 0) {
					logger.log(`Applying ${replacements.length} code replacements...`);
					await Bun.write(clientFile, updatedCode);

					logger.log("Running code quality validations...");
					const typecheckProc = Bun.spawn(["bun", "run", "typecheck"]);
					const typecheckExit = await typecheckProc.exited;

					const lintProc = Bun.spawn(["bun", "run", "lint"]);
					const lintExit = await lintProc.exited;

					const testProc = Bun.spawn(["bun", "test", "test/", "packages/", "src/"]);
					const testExit = await testProc.exited;

					if (typecheckExit !== 0 || lintExit !== 0 || testExit !== 0) {
						logger.error("Validation failed! Rolling back changes to original state.");
						await Bun.write(clientFile, originalCode);
						throw new Error("Autonomous upgrade failed validation tests. Rolled back successfully.");
					} else {
						logger.log("Validation passed successfully! Code upgraded.");
					}
				} else {
					logger.log("No upgrades required. Codebase features are fully up to date.");
				}

				Bun.stdout.write(
					JSON.stringify(
						{
							success: true,
							scraped_mappings_count: Object.keys(data.rpc_mappings).length,
							replacements_applied: replacements,
							upgraded: replacements.length > 0,
						},
						null,
						2,
					) + "\n",
				);
				break;
			}

			default: {
				logger.error(`Unknown action: ${action}`);
				printUsage();
				process.exit(EXIT.MISUSE);
			}
		}
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.DATA_ERR);
	}
}
