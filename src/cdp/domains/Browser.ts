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
 * Browser domain handler.
 *
 * Handles: Browser.getVersion, Browser.close,
 *          Browser.getWindowForTarget, Browser.grantPermissions,
 *          Browser.setDownloadBehavior, Browser.setContentsSize
 *
 * Events emitted (via helper, called externally):
 *   Browser.downloadWillBegin  — before a download starts
 *   Browser.downloadProgress   — download progress updates
 */

import type { DispatchContext, DomainHandler } from "../types.js";

// ---------------------------------------------------------------------------
// Browser-level state (module-scoped, shared for the lifetime of the handler)
// ---------------------------------------------------------------------------

/** Granted permission jar: origin -> granted permission types */
const grantedPermissions = new Map<string, string[]>();

/** Download behavior config */
export interface DownloadConfig {
	behavior: "deny" | "allow" | "allowAndName" | "default";
	downloadPath?: string;
}
let downloadConfig: DownloadConfig = { behavior: "default" };

/** Viewport / content size override */
export interface ContentSize {
	width: number;
	height: number;
}
let contentSize: ContentSize = { width: 1280, height: 720 };

// ---------------------------------------------------------------------------
// Public helpers for other domains / tests
// ---------------------------------------------------------------------------

/** Returns the current download configuration. */
export function getDownloadConfig(): Readonly<DownloadConfig> {
	return downloadConfig;
}

/** Returns the current content size (viewport). */
export function getContentSize(): Readonly<ContentSize> {
	return contentSize;
}

/** Returns the permissions granted for a given origin. */
export function getGrantedPermissions(origin: string): string[] {
	return grantedPermissions.get(origin) ?? [];
}

// ---------------------------------------------------------------------------
// Download event helpers
// ---------------------------------------------------------------------------

/**
 * Emits Browser.downloadWillBegin to all sessions.
 * Call this when a navigation or resource triggers a download.
 */
export function emitDownloadWillBegin(
	ctx: DispatchContext,
	opts: {
		guid: string;
		url: string;
		suggestedFilename: string;
		frameId?: string;
	},
): void {
	ctx.emitEvent({
		method: "Browser.downloadWillBegin",
		params: {
			frameId: opts.frameId ?? "",
			guid: opts.guid,
			url: opts.url,
			suggestedFilename: opts.suggestedFilename,
		},
	});
}

/**
 * Emits Browser.downloadProgress to all sessions.
 * state: "inProgress" | "completed" | "canceled"
 */
export function emitDownloadProgress(
	ctx: DispatchContext,
	opts: {
		guid: string;
		totalBytes: number;
		receivedBytes: number;
		state: "inProgress" | "completed" | "canceled";
	},
): void {
	ctx.emitEvent({
		method: "Browser.downloadProgress",
		params: {
			guid: opts.guid,
			totalBytes: opts.totalBytes,
			receivedBytes: opts.receivedBytes,
			state: opts.state,
		},
	});
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const BrowserHandler: DomainHandler = async (
	method,
	params,
	ctx,
	_sessionId,
) => {
	switch (method) {
		case "Browser.getVersion":
			return {
				protocolVersion: "1.3",
				product: "Bxc/0.1.0 StaticDom",
				revision: "bxc-static",
				userAgent: "Bxc/0.1.0 (StaticDomTransport)",
				jsVersion: "0.0.0",
			};

		case "Browser.close":
			ctx.transport?.close();
			return {};

		// -----------------------------------------------------------------
		// Phase 1 additions
		// -----------------------------------------------------------------

		case "Browser.getWindowForTarget": {
			// Return a synthetic window ID with default viewport bounds.
			const { targetId } = params as { targetId?: string };
			void targetId; // No real window management in static mode.
			return {
				windowId: 1,
				bounds: {
					left: 0,
					top: 0,
					width: contentSize.width,
					height: contentSize.height,
					windowState: "normal",
				},
			};
		}

		case "Browser.grantPermissions": {
			// Store permissions in the in-memory jar; no enforcement in static mode.
			const { origin, permissions } = params as {
				origin?: string;
				permissions: string[];
			};
			const key = origin ?? "*";
			const existing = grantedPermissions.get(key) ?? [];
			const merged = [...new Set([...existing, ...permissions])];
			grantedPermissions.set(key, merged);
			return {};
		}

		case "Browser.setDownloadBehavior": {
			// Store config for use when a download is triggered.
			const { behavior, downloadPath } = params as {
				behavior: "deny" | "allow" | "allowAndName" | "default";
				downloadPath?: string;
			};
			downloadConfig = { behavior, downloadPath };
			return {};
		}

		case "Browser.setContentsSize": {
			// Store viewport dimensions; applied on next Page.navigate.
			const { width, height } = params as { width: number; height: number };
			contentSize = { width, height };
			return {};
		}

		default:
			return null;
	}
};
