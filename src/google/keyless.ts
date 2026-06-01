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
 * @module bxc/google/keyless
 *
 * Keyless, anonymous, and public Google API integration module.
 */

export class ApiError extends Error {
	constructor(
		public statusCode: number,
		public statusText: string,
		public url: string,
	) {
		super(`API Error ${statusCode}: ${statusText} (URL: ${url})`);
		this.name = "ApiError";
	}
}

export class KeylessGoogleClient {
	private async request(
		method: string,
		url: string,
		params?: Record<string, any>,
		headers?: Record<string, string>,
	): Promise<Response> {
		let finalUrl = url;
		if (params) {
			const query = new URLSearchParams();
			for (const [key, value] of Object.entries(params)) {
				if (value !== undefined && value !== null) {
					query.append(key, String(value));
				}
			}
			const queryString = query.toString();
			if (queryString) {
				finalUrl += (url.includes("?") ? "&" : "?") + queryString;
			}
		}

		const response = await fetch(finalUrl, {
			method,
			headers,
		});

		if (!response.ok) {
			const text = await response.text();
			throw new ApiError(response.status, text, finalUrl);
		}

		return response;
	}

	/**
	 * Query Google Public DNS-over-HTTPS.
	 */
	async resolveDns(name: string, type: string = "A"): Promise<any> {
		const url = "https://dns.google/resolve";
		const response = await this.request("GET", url, { name, type });
		return response.json();
	}

	/**
	 * Search the public Google Books catalog.
	 */
	async searchBooks(
		query: string,
		maxResults: number = 10,
		startIndex: number = 0,
	): Promise<any> {
		const url = "https://www.googleapis.com/books/v1/volumes";
		const response = await this.request("GET", url, {
			q: query,
			maxResults,
			startIndex,
		});
		return response.json();
	}

	/**
	 * Retrieve a specific Google Books volume by its ID.
	 */
	async getBook(volumeId: string): Promise<any> {
		const url = `https://www.googleapis.com/books/v1/volumes/${volumeId}`;
		const response = await this.request("GET", url);
		return response.json();
	}

	/**
	 * Translate text using the keyless Google Translate API.
	 */
	async translate(
		text: string,
		targetLang: string = "en",
		sourceLang: string = "auto",
	): Promise<string> {
		const url = "https://translate.googleapis.com/translate_a/single";
		const response = await this.request("GET", url, {
			client: "gtx",
			sl: sourceLang,
			tl: targetLang,
			dt: "t",
			q: text,
		});
		const data = await response.json();
		const translations: string[] = [];
		if (data && Array.isArray(data) && data[0]) {
			for (const item of data[0]) {
				if (item && Array.isArray(item) && item.length > 0) {
					translations.push(item[0]);
				}
			}
		}
		return translations.join("");
	}

	/**
	 * Get query suggestions using Google Autocomplete.
	 */
	async autocomplete(
		query: string,
		client: string = "chrome",
	): Promise<string[]> {
		const url = "https://suggestqueries.google.com/complete/search";
		const response = await this.request("GET", url, { client, q: query });
		const data = await response.json();
		if (data && Array.isArray(data) && data.length > 1 && Array.isArray(data[1])) {
			return data[1].map(String);
		}
		return [];
	}

	/**
	 * Fetch and parse events from a public Google iCalendar feed.
	 */
	async getPublicCalendarEvents(calendarId: string): Promise<any[]> {
		const url = `https://calendar.google.com/calendar/ical/${calendarId}/public/basic.ics`;
		const response = await this.request("GET", url);
		const rawText = await response.text();

		// Unfold lines according to RFC 5545 (line folded by starting with space/tab)
		const lines: string[] = [];
		const rawLines = rawText.split(/\r?\n/);
		for (const line of rawLines) {
			if (line.startsWith(" ") || line.startsWith("\t")) {
				if (lines.length > 0) {
					lines[lines.length - 1] += line.slice(1);
				}
			} else {
				lines.push(line);
			}
		}

		const events: any[] = [];
		let currentEvent: Record<string, any> | null = null;

		for (const line of lines) {
			if (line.startsWith("BEGIN:VEVENT")) {
				currentEvent = {};
			} else if (line.startsWith("END:VEVENT")) {
				if (currentEvent !== null) {
					events.push(currentEvent);
					currentEvent = null;
				}
			} else if (currentEvent !== null) {
				if (line.includes(":")) {
					const colonIdx = line.indexOf(":");
					const keyPart = line.slice(0, colonIdx);
					let value = line.slice(colonIdx + 1);
					const key = keyPart.split(";")[0].toUpperCase();
					// Basic unescaping of common ics characters
					value = value
						.replaceAll("\\,", ",")
						.replaceAll("\\;", ";")
						.replaceAll("\\n", "\n")
						.replaceAll("\\N", "\n");
					currentEvent[key.toLowerCase()] = value;
				}
			}
		}

		return events;
	}

	/**
	 * Export a public Google Sheet to CSV.
	 */
	async exportPublicSheetToCsv(
		spreadsheetId: string,
		gid?: string,
	): Promise<string> {
		const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`;
		const params: Record<string, any> = { format: "csv" };
		if (gid) {
			params.gid = gid;
		}
		const response = await this.request("GET", url, params);
		return response.text();
	}

	/**
	 * Export a public Google Doc to plain text.
	 */
	async exportPublicDocToText(documentId: string): Promise<string> {
		const url = `https://docs.google.com/document/d/${documentId}/export`;
		const response = await this.request("GET", url, { format: "txt" });
		return response.text();
	}

	/**
	 * Download a public Google Drive file by ID, handling virus scan redirects.
	 */
	async downloadPublicDriveFile(fileId: string): Promise<Uint8Array> {
		const url = "https://docs.google.com/uc";
		const params = new URLSearchParams({ export: "download", id: fileId });

		const firstUrl = `${url}?${params.toString()}`;
		const response = await fetch(firstUrl);

		let confirmToken: string | null = null;
		const setCookie = response.headers.get("set-cookie");
		if (setCookie) {
			const match = setCookie.match(/download_warning[^=]*=([^;]+)/);
			if (match) {
				confirmToken = match[1];
			}
		}

		if (!confirmToken) {
			const cloned = response.clone();
			const text = await cloned.text();
			const match = text.match(/confirm=([0-9A-Za-z_]+)/);
			if (match) {
				confirmToken = match[1];
			}
		}

		if (confirmToken) {
			params.set("confirm", confirmToken);
			const secondUrl = `${url}?${params.toString()}`;
			const secondResponse = await fetch(secondUrl);
			if (!secondResponse.ok) {
				const text = await secondResponse.text();
				throw new ApiError(secondResponse.status, text, secondUrl);
			}
			const buffer = await secondResponse.arrayBuffer();
			return new Uint8Array(buffer);
		} else {
			if (!response.ok) {
				const text = await response.text();
				throw new ApiError(response.status, text, firstUrl);
			}
			const buffer = await response.arrayBuffer();
			return new Uint8Array(buffer);
		}
	}
}
