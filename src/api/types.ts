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
 * @module bxc/api/types
 */

import type { Locator } from "./Locator.ts";
import type { Frame } from "./Frame.ts";
import type { BrowserContext } from "./BrowserContext.ts";
import type {
	NavigationResponse,
	GotoOptions,
	ScreenshotOptions,
	PDFOptions,
	PageOptions,
} from "./browser.ts";

/**
 * Unified interface for all Bxc pages (Page and HttpPage).
 */
export interface AnyPage extends AsyncDisposable {
	url(): string;
	title(): Promise<string>;
	content(): Promise<string>;
	markdown(): Promise<string>;
	goto(url: string, options?: GotoOptions): Promise<NavigationResponse>;
	close(): Promise<void>;
	context(): BrowserContext | null;
	profile(): string;
	upgradeProfile(newProfile: string, options?: PageOptions): Promise<AnyPage>;

	// Common Methods
	evaluate<T, R = unknown>(fn: (arg: R) => T, arg?: R): Promise<T>;
	setContent(html: string, options?: GotoOptions): Promise<void>;
	addCookies(
		cookies: Array<{
			name: string;
			value: string;
			url?: string;
			domain?: string;
			path?: string;
			expires?: number;
			secure?: boolean;
			httpOnly?: boolean;
			sameSite?: "Strict" | "Lax" | "None";
		}>,
	): Promise<void>;

	// Methods common to all profiles
	locator(selector: string): Locator;
	mainFrame(): Frame;
	frames(): Frame[];
	$<E = unknown>(selector: string): Promise<E | null>;
	$$<E = unknown>(selector: string): Promise<E[]>;
	screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;
	pdf(options?: PDFOptions): Promise<Uint8Array>;

	// Agentic / AI
	aiExtract?(instruction: string): Promise<{
		data: Record<string, string | string[]>;
		selectors: Record<string, string>;
	}>;
	aiAct?(instruction: string): Promise<void>;

	// Optional or Stubbed in HttpPage
	click?(selector: string, options?: { timeout?: number }): Promise<void>;
	fill?(
		selector: string,
		text: string,
		options?: { timeout?: number },
	): Promise<void>;
}
