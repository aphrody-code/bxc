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
 * @module test/e2e/apify-fixtures
 *
 * Static fixtures for the Apify E2E crawl suite.
 */

export const APIFY_SLUGS = ["about", "pricing", "store"] as const;
export type ApifySlug = (typeof APIFY_SLUGS)[number];

export const APIFY_USERS = ["pricing", "about"] as const;
export type ApifyUser = (typeof APIFY_USERS)[number];

export interface ApifyPattern {
	name: string;
	urlBuilder: (slugOrUser: string) => string;
	expectedMinBytes: number;
	signalCheck: (body: string) => boolean;
	category: string;
	requiresUser?: boolean;
}

export function isCloudflareWall(body: string): boolean {
	return /Just a moment|Checking your browser|cf-mitigated|Enable JavaScript and cookies|cf_chl_opt/i.test(
		body,
	);
}

export const APIFY_PATTERNS: readonly ApifyPattern[] = [
	{
		name: "landing-page",
		urlBuilder: (slug) => `https://apify.com/${slug === "about" ? "" : slug}`,
		expectedMinBytes: 2_000,
		signalCheck: (body) =>
			/apify|crawlee|actor|store|crawler/i.test(body) &&
			!isCloudflareWall(body),
		category: "scraper",
	},
	{
		name: "about-page",
		urlBuilder: () => "https://apify.com/about",
		expectedMinBytes: 2_000,
		signalCheck: (body) =>
			/apify|about|team|platform/i.test(body) && !isCloudflareWall(body),
		category: "htmlrewriter",
	},
	{
		name: "pricing-page",
		urlBuilder: () => "https://apify.com/pricing",
		expectedMinBytes: 2_000,
		signalCheck: (body) =>
			/apify|pricing|billing|subscription/i.test(body) &&
			!isCloudflareWall(body),
		category: "json",
	},
	{
		name: "partners-page",
		urlBuilder: () => "https://apify.com/partners",
		expectedMinBytes: 2_000,
		signalCheck: (body) =>
			/apify|partner|expert|integration/i.test(body) && !isCloudflareWall(body),
		category: "log",
	},
	{
		name: "store-page",
		urlBuilder: () => "https://apify.com/store",
		expectedMinBytes: 2_000,
		signalCheck: (body) =>
			/apify|crawlee|actor|store/i.test(body) && !isCloudflareWall(body),
		category: "standings",
	},
	{
		name: "changelog-page",
		urlBuilder: () => "https://apify.com/changelog",
		expectedMinBytes: 2_000,
		signalCheck: (body) =>
			/apify|changelog|release|updates/i.test(body) && !isCloudflareWall(body),
		category: "participants",
	},
	{
		name: "user-profile",
		urlBuilder: (user) => `https://apify.com/${user}`,
		expectedMinBytes: 2_000,
		signalCheck: (body) =>
			/apify|crawlee|actor|store|crawler/i.test(body) &&
			!isCloudflareWall(body),
		category: "user",
		requiresUser: true,
	},
	{
		name: "user-tournaments",
		urlBuilder: (user) => `https://apify.com/${user}`,
		expectedMinBytes: 2_000,
		signalCheck: (body) =>
			/apify|crawlee|actor|store|crawler/i.test(body) &&
			!isCloudflareWall(body),
		category: "user-list",
		requiresUser: true,
	},
	{
		name: "community-satr",
		urlBuilder: () => "https://apify.com/",
		expectedMinBytes: 2_000,
		signalCheck: (body) =>
			/apify|crawlee|actor|store|crawler/i.test(body) &&
			!isCloudflareWall(body),
		category: "community",
	},
] as const;
