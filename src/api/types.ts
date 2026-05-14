/**
 * @module bunlight/api/types
 */

import type { Locator } from "./Locator.ts";
import type { Frame } from "./Frame.ts";
import type { BrowserContext } from "./BrowserContext.ts";
import type { NavigationResponse, GotoOptions, ScreenshotOptions, PDFOptions } from "./browser.ts";

/**
 * Unified interface for all Bunlight pages (Page and HttpPage).
 */
export interface AnyPage extends AsyncDisposable {
	url(): string;
	title(): Promise<string>;
	content(): Promise<string>;
	goto(url: string, options?: GotoOptions): Promise<NavigationResponse>;
	close(): Promise<void>;
	context(): BrowserContext | null;
	profile(): string;
	upgradeProfile(newProfile: string, options?: PageOptions): Promise<AnyPage>;
	
	// Optional or Stubbed in HttpPage
	locator?(selector: string): Locator;
	click?(selector: string, options?: { timeout?: number }): Promise<void>;
	fill?(selector: string, text: string, options?: { timeout?: number }): Promise<void>;
	screenshot?(options?: ScreenshotOptions): Promise<Uint8Array>;
	pdf?(options?: PDFOptions): Promise<Uint8Array>;
	mainFrame?(): Frame;
	frames?(): Frame[];
}
