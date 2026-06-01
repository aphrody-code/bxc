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

import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { BxcDB } from "../src/db/BxcDB.ts";
import { generateOpenApiSchema } from "../src/utils/openapi.ts";
import { BxcClient } from "../src/sdk/BxcClient.ts";
import { AutonomousCrawler } from "../src/crawler/AutonomousCrawler.ts";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";

describe("Bxc Autonomous Crawler & Cache", () => {
	const testDbPath = join(import.meta.dir, "fixtures/test_autonomous_crawler.sqlite");

	beforeAll(() => {
		if (existsSync(testDbPath)) {
			try { unlinkSync(testDbPath); } catch {}
		}
	});

	afterAll(() => {
		if (existsSync(testDbPath)) {
			try { unlinkSync(testDbPath); } catch {}
		}
	});

	test("BxcDB cache columns and migrations", () => {
		const db = new BxcDB(testDbPath);
		
		const url = "https://example.com/api-test";
		const profile = "static";
		const status = 200;
		const content = "<html><body><h1>Hello World</h1></body></html>";
		const metadata = { title: "Hello World" };
		const markdown = "# Hello World";
		const jsonData = { message: "Hello World", count: 42 };
		const openapiSpec = { openapi: "3.0.0", info: { title: "Test Spec" } };

		db.saveScrape(url, profile, status, content, metadata, markdown, jsonData, openapiSpec);

		const result = db.getScrapeByUrl(url);
		expect(result).toBeDefined();
		expect(result.url).toBe(url);
		expect(result.status).toBe(status);
		expect(result.markdown).toBe(markdown);
		
		const parsedJson = JSON.parse(result.json_data);
		expect(parsedJson.count).toBe(42);

		const parsedOpenApi = JSON.parse(result.openapi_spec);
		expect(parsedOpenApi.info.title).toBe("Test Spec");

		db.close();
	});

	test("OpenAPI schema dynamic generator", () => {
		const mockData = {
			url: "https://example.com/items/details",
			title: "Product Details Page",
			description: "This page shows product specifications.",
			markdown: "# Product Details\nWe have items.",
			timestamp: new Date().toISOString(),
			structuredData: {
				id: 12345,
				name: "Wireless Headphones",
				inStock: true,
				price: 99.99,
				ratings: [5, 4, 5],
				seller: {
					name: "AudioCorp",
					rating: 4.8
				}
			},
			links: ["https://example.com/items/details", "https://example.com/about"]
		};

		const schema = generateOpenApiSchema(mockData);

		expect(schema.openapi).toBe("3.0.0");
		expect(schema.info.title).toContain("Product Details Page");
		expect(schema.paths["/items_details"]).toBeDefined();
		
		const properties = schema.paths["/items_details"].get.responses["200"].content["application/json"].schema.properties;
		expect(properties.url.type).toBe("string");
		expect(properties.title.type).toBe("string");
		expect(properties.markdown.type).toBe("string");
		expect(properties.links.type).toBe("array");

		const structProps = properties.structuredData.properties;
		expect(structProps.id.type).toBe("number");
		expect(structProps.name.type).toBe("string");
		expect(structProps.inStock.type).toBe("boolean");
		expect(structProps.price.type).toBe("number");
		expect(structProps.ratings.type).toBe("array");
		expect(structProps.seller.properties.name.type).toBe("string");
		expect(structProps.seller.properties.rating.type).toBe("number");
	});

	test("BxcClient SDK initialization", () => {
		const client = new BxcClient({ endpoint: "http://localhost:8080" });
		expect(client).toBeDefined();
	});

	test("AutonomousCrawler initialization", () => {
		const crawler = new AutonomousCrawler({
			maxDepth: 3,
			profile: "static"
		});
		expect(crawler).toBeDefined();
		expect(crawler.stats()).toBeDefined();
	});
});
