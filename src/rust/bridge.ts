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

const SYMBOLS = {
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
} as const;

function loadLib() {
	return dlopen(resolveRustBridgePath(), SYMBOLS);
}

type BridgeLib = ReturnType<typeof loadLib>;

let _lib: BridgeLib | null = null;
let _loadError: Error | null = null;

/**
 * Lazily opens the rust-bridge cdylib on first use.
 *
 * Opening the library at import time crashes every code path that merely
 * imports this module when the cdylib has not been built — defeating the
 * regex fallbacks in `html-utils.ts`. Deferring the `dlopen` to first call
 * lets those `try/catch` fallbacks actually fire, and turns a hard crash into
 * an actionable error for paths that genuinely need the native engine.
 */
function symbols(): BridgeLib["symbols"] {
	if (_lib) return _lib.symbols;
	if (_loadError) throw _loadError;
	try {
		_lib = loadLib();
		return _lib.symbols;
	} catch (err) {
		_loadError = new Error(
			`bxc rust-bridge cdylib could not be loaded from "${resolveRustBridgePath()}". ` +
				`Build it with \`bun run build:linux\` (or \`cargo build -p bxc-rust-bridge --release\`), ` +
				`or set BXC_RUST_BRIDGE_LIB to an existing .${suffix}. ` +
				`Cause: ${err instanceof Error ? err.message : String(err)}`,
		);
		throw _loadError;
	}
}

export type DomTreePtr = number;

export function parseHtml(html: string): DomTreePtr {
	const htmlPtr = ptr(Buffer.from(html + "\0"));
	return symbols().bxc_parse_html(htmlPtr) as DomTreePtr;
}

export function destroyTree(tree: DomTreePtr): void {
	symbols().bxc_tree_destroy(tree as any);
}

export function querySelector(
	tree: DomTreePtr,
	selector: string,
): string | null {
	const sym = symbols();
	const selPtr = ptr(Buffer.from(selector + "\0"));
	const resultPtr = sym.bxc_query_selector(tree as any, selPtr);
	if (!resultPtr) return null;

	const result = new CString(resultPtr).toString();
	sym.bxc_free_string(resultPtr);
	return result;
}

export function querySelectorAll(tree: DomTreePtr, selector: string): string[] {
	const sym = symbols();
	const selPtr = ptr(Buffer.from(selector + "\0"));
	const resultPtr = sym.bxc_query_selector_all(tree as any, selPtr);
	if (!resultPtr) return [];

	const json = new CString(resultPtr).toString();
	sym.bxc_free_string(resultPtr);
	try {
		return JSON.parse(json);
	} catch {
		return [];
	}
}

export function htmlToMarkdown(html: string): string {
	const sym = symbols();
	const htmlPtr = ptr(Buffer.from(html + "\0"));
	const resultPtr = sym.bxc_html_to_markdown(htmlPtr);
	if (!resultPtr) return "";

	const result = new CString(resultPtr).toString();
	sym.bxc_free_string(resultPtr);
	return result;
}

export function extractTitle(html: string): string {
	const sym = symbols();
	const htmlPtr = ptr(Buffer.from(html + "\0"));
	const resultPtr = sym.bxc_extract_title(htmlPtr);
	if (!resultPtr) return "";

	const result = new CString(resultPtr).toString();
	sym.bxc_free_string(resultPtr);
	return result;
}

export function stripTags(html: string): string {
	const sym = symbols();
	const htmlPtr = ptr(Buffer.from(html + "\0"));
	const resultPtr = sym.bxc_strip_tags(htmlPtr);
	if (!resultPtr) return html;

	const result = new CString(resultPtr).toString();
	sym.bxc_free_string(resultPtr);
	return result;
}
