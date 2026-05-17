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

import { CString, dlopen, FFIType, ptr, suffix } from "bun:ffi";
import { join } from "node:path";

/**
 * Resolves the rust-bridge cdylib path.
 */
function resolveRustBridgePath(): string {
	const envOverride = Bun.env["BXC_RUST_BRIDGE_LIB"];
	if (envOverride) return envOverride;

	const repoRoot = join(import.meta.dir, "..", "..");
	const targetDir = join(repoRoot, "rust-bridge", "target", "release");
	const name =
		process.platform === "win32"
			? `bxc_rust_bridge.${suffix}`
			: `libbxc_rust_bridge.${suffix}`;
	return join(targetDir, name);
}

const libPath = resolveRustBridgePath();

const lib = dlopen(libPath, {
	bxc_parse_html: {
		args: [FFIType.ptr],
		returns: FFIType.ptr,
	},
	bxc_tree_destroy: {
		args: [FFIType.ptr],
		returns: FFIType.void,
	},
	bxc_query_selector: {
		args: [FFIType.ptr, FFIType.ptr],
		returns: FFIType.ptr,
	},
	bxc_query_selector_all: {
		args: [FFIType.ptr, FFIType.ptr],
		returns: FFIType.ptr,
	},
	bxc_free_string: {
		args: [FFIType.ptr],
		returns: FFIType.void,
	},
	bxc_html_to_markdown: {
		args: [FFIType.ptr],
		returns: FFIType.ptr,
	},
	bxc_extract_title: {
		args: [FFIType.ptr],
		returns: FFIType.ptr,
	},
	bxc_strip_tags: {
		args: [FFIType.ptr],
		returns: FFIType.ptr,
	},
});

export type DomTreePtr = number;

export function parseHtml(html: string): DomTreePtr {
	const htmlPtr = ptr(Buffer.from(html + "\0"));
	return lib.symbols.bxc_parse_html(htmlPtr) as DomTreePtr;
}

export function destroyTree(tree: DomTreePtr): void {
	lib.symbols.bxc_tree_destroy(tree as any);
}

export function querySelector(tree: DomTreePtr, selector: string): string | null {
	const selPtr = ptr(Buffer.from(selector + "\0"));
	const resultPtr = lib.symbols.bxc_query_selector(tree as any, selPtr);
	if (!resultPtr) return null;

	const result = new CString(resultPtr).toString();
	lib.symbols.bxc_free_string(resultPtr);
	return result;
}

export function querySelectorAll(tree: DomTreePtr, selector: string): string[] {
	const selPtr = ptr(Buffer.from(selector + "\0"));
	const resultPtr = lib.symbols.bxc_query_selector_all(tree as any, selPtr);
	if (!resultPtr) return [];

	const json = new CString(resultPtr).toString();
	lib.symbols.bxc_free_string(resultPtr);
	try {
		return JSON.parse(json);
	} catch {
		return [];
	}
}

export function htmlToMarkdown(html: string): string {
	const htmlPtr = ptr(Buffer.from(html + "\0"));
	const resultPtr = lib.symbols.bxc_html_to_markdown(htmlPtr);
	if (!resultPtr) return "";

	const result = new CString(resultPtr).toString();
	lib.symbols.bxc_free_string(resultPtr);
	return result;
}

export function extractTitle(html: string): string {
	const htmlPtr = ptr(Buffer.from(html + "\0"));
	const resultPtr = lib.symbols.bxc_extract_title(htmlPtr);
	if (!resultPtr) return "";

	const result = new CString(resultPtr).toString();
	lib.symbols.bxc_free_string(resultPtr);
	return result;
}

export function stripTags(html: string): string {
	const htmlPtr = ptr(Buffer.from(html + "\0"));
	const resultPtr = lib.symbols.bxc_strip_tags(htmlPtr);
	if (!resultPtr) return html;

	const result = new CString(resultPtr).toString();
	lib.symbols.bxc_free_string(resultPtr);
	return result;
}
