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

import { Browser } from "@aphrody-code/bxc";
import * as cheerio from "cheerio";

export interface ZukanCharacterRef {
	id: string;
	name: string;
	url: string;
	avatarUrl: string | null;
}

export interface ZukanCharacterDetail {
	id: string;
	nameJa: string;
	nameEn?: string;
	nameFr?: string;
	position?: string;
	element?: string;
	team?: string;
	imageUrl?: string;
	stats?: Record<string, number>;
	techniques?: string[];
}

export class ZukanScraper {
	/**
	 * Scrapes the main character list page from zukan.inazuma.jp.
	 * 
	 * @param locale Optional locale filter (e.g. 'en', 'fr', 'ja')
	 */
	async getCharacterList(locale = "ja"): Promise<ZukanCharacterRef[]> {
		const baseUrl = `https://zukan.inazuma.jp/${locale === "ja" ? "" : locale + "/"}`;
		const page = await Browser.newPage({
			profile: "fast",
			insecure: true
		});

		try {
			console.log(`[ZukanScraper] Navigating to character list: ${baseUrl}`);
			await page.goto(baseUrl);
			const html = await page.content();
			const $ = cheerio.load(html);
			
			const characters: ZukanCharacterRef[] = [];
			$(".charaListArea li, .chara_list_area li").each((_, elem) => {
				const link = $(elem).find("a");
				const href = link.attr("href") || "";
				const img = $(elem).find("img");
				const name = $(elem).find(".name, p").text().trim();
				
				if (href) {
					// Resolve character ID from URL parameters or slug
					const urlObj = new URL(href, baseUrl);
					const q = urlObj.searchParams.get("q") || href.split("/").pop() || "";
					
					characters.push({
						id: q,
						name: name || img.attr("alt") || "Unknown Chara",
						url: urlObj.toString(),
						avatarUrl: img.attr("src") || null
					});
				}
			});
			
			return characters;
		} finally {
			await page.close();
		}
	}

	/**
	 * Scrapes a single character detail page from zukan.inazuma.jp.
	 * 
	 * @param queryParam The query parameter 'q' or full URL of the character sheet.
	 * @param locale Optional locale filter.
	 */
	async getCharacterDetail(queryParam: string, locale = "ja"): Promise<ZukanCharacterDetail> {
		let targetUrl = queryParam;
		if (!targetUrl.startsWith("http")) {
			const prefix = locale === "ja" ? "" : `${locale}/`;
			targetUrl = `https://zukan.inazuma.jp/${prefix}chara_model_view/?q=${queryParam}`;
		}
		
		const page = await Browser.newPage({
			profile: "fast",
			insecure: true
		});

		try {
			console.log(`[ZukanScraper] Navigating to character detail: ${targetUrl}`);
			await page.goto(targetUrl);
			const html = await page.content();
			const $ = cheerio.load(html);
			
			const id = new URL(targetUrl).searchParams.get("q") || queryParam;
			const nameJa = $(".charaName, .chara_name").text().trim();
			const position = $(".position, .chara_pos").text().trim();
			const element = $(".element, .chara_element").text().trim();
			const team = $(".team, .chara_team").text().trim();
			const imageUrl = $(".charaImage img, .chara_img img").attr("src") || undefined;
			
			const stats: Record<string, number> = {};
			$(".statsTable tr, .status_table tr").each((_, row) => {
				const label = $(row).find("th, td.label").text().trim();
				const valStr = $(row).find("td.value, td:last-child").text().trim();
				const val = parseInt(valStr, 10);
				if (label && !isNaN(val)) {
					stats[label] = val;
				}
			});
			
			const techniques: string[] = [];
			$(".skillsList li, .technique_list li").each((_, item) => {
				const techName = $(item).text().trim();
				if (techName) {
					techniques.push(techName);
				}
			});
			
			return {
				id,
				nameJa,
				position,
				element,
				team,
				imageUrl,
				stats,
				techniques
			};
		} finally {
			await page.close();
		}
	}
}
