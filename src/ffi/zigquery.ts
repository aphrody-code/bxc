/**
 * @module bunlight/ffi/zigquery
 *
 * Reusable FFI binding for `liblightpanda_dom.{so,dylib}` — the C ABI exported
 * by the `vendor/zigquery-wrapper` Zig project (backed by zigquery / lexbor).
 *
 * This module is the single point of truth for talking to the Zig DOM library.
 * `StaticDomTransport` and any other consumer should import the high-level
 * helpers (`ZigDoc`, `ZigSelection`) instead of touching `bun:ffi` directly.
 *
 * Library lookup order:
 *   1. `BUNLIGHT_LIGHTPANDA_DOM_LIB` env var (absolute path)
 *   2. `vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.{suffix}` relative
 *      to this file
 *
 * A single `bl_init()` is performed lazily on first access; `bl_deinit()` runs
 * at process exit.  The library is process-global — there is at most one open
 * `dlopen` handle for its lifetime.
 *
 * @example
 * ```ts
 * import { parseHtml } from "bunlight/ffi/zigquery";
 *
 * const doc = parseHtml("<h1 id=t>Hi</h1>");
 * const sel = doc.find("h1");
 * console.log(sel.at(0)?.textContent()); // "Hi"
 * sel.destroy();
 * doc.destroy();
 * ```
 */

import { dlopen, FFIType, suffix, ptr, read, type Pointer } from "bun:ffi";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// BlString — extern struct returned by _into() out-pointer wrappers.
// Layout (must match exports.zig):
//   data: [*]const u8   — 8 bytes (ptr)
//   len:  usize         — 8 bytes
//   cap:  usize         — 8 bytes
// Total: 24 bytes on 64-bit
// ---------------------------------------------------------------------------

/** Size of `BlString` in bytes (64-bit). */
export const BL_STRING_SIZE = 24;

/**
 * Reads a `BlString` written by a Zig `_into` wrapper into a JS string.
 * Works on 64-bit little-endian hosts (Linux x64, macOS arm64/x64).
 */
export function readBlString(out: Uint8Array, offset = 0): string {
	const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
	const dataPtrLow = view.getUint32(offset + 0, true);
	const dataPtrHigh = view.getUint32(offset + 4, true);
	const len = Number(view.getBigUint64(offset + 8, true));
	if (len === 0) return "";

	const dataPtr = dataPtrLow + dataPtrHigh * 0x1_0000_0000;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = read.u8(dataPtr + i);
	}
	return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// Library resolution + dlopen
// ---------------------------------------------------------------------------

function resolveLibPath(): string {
	// Prefer an explicit env override — we attempt it first and let dlopen surface
	// any "not found" error with a clear path in the message.
	const envOverride = process.env["BUNLIGHT_LIGHTPANDA_DOM_LIB"];
	if (envOverride) return envOverride;

	// Bun-native path resolution: import.meta.dir replaces fileURLToPath(dirname(...))
	const fallback = join(
		import.meta.dir,
		"..",
		"..",
		"vendor",
		"zigquery-wrapper",
		"zig-out",
		"lib",
		`liblightpanda_dom.${suffix}`,
	);
	return fallback;
}

function openLib() {
	return dlopen(resolveLibPath(), {
		bl_init: { returns: FFIType.i32 },
		bl_deinit: { returns: "void" },

		bl_doc_from_html: {
			args: [FFIType.ptr, FFIType.usize],
			returns: FFIType.ptr,
		},
		bl_doc_destroy: {
			args: [FFIType.ptr],
			returns: "void",
		},

		bl_doc_find: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.usize],
			returns: FFIType.ptr,
		},
		bl_sel_count: {
			args: [FFIType.ptr],
			returns: FFIType.usize,
		},
		bl_sel_at: {
			args: [FFIType.ptr, FFIType.usize],
			returns: FFIType.ptr,
		},
		bl_sel_destroy: {
			args: [FFIType.ptr],
			returns: "void",
		},

		bl_sel_text_into: {
			args: [FFIType.ptr, FFIType.ptr],
			returns: "void",
		},
		bl_sel_html_into: {
			args: [FFIType.ptr, FFIType.ptr],
			returns: "void",
		},
		bl_sel_outer_html_into: {
			args: [FFIType.ptr, FFIType.ptr],
			returns: "void",
		},
		bl_sel_attr_into: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.usize, FFIType.ptr],
			returns: "void",
		},
		bl_sel_tag_name_into: {
			args: [FFIType.ptr, FFIType.ptr],
			returns: "void",
		},

		bl_string_free: {
			args: [FFIType.ptr],
			returns: "void",
		},

		bl_last_error: {
			returns: FFIType.cstring,
		},
	});
}

type Lib = ReturnType<typeof openLib>;

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let _lib: Lib | null = null;
let _initFailed = false;
let _initError: Error | null = null;

/**
 * Returns whether the zigquery FFI library is available on this system.
 * Cheap idempotent check — does not throw.
 */
export function isZigQueryAvailable(): boolean {
	if (_lib) return true;
	if (_initFailed) return false;
	try {
		ensureInit();
		return true;
	} catch {
		return false;
	}
}

/**
 * Forces initialization (for callers that want to surface load failures
 * eagerly).  Idempotent.
 */
export function ensureInit(): Lib {
	if (_lib) return _lib;
	if (_initFailed) {
		throw _initError ?? new Error("zigquery FFI failed to initialize");
	}
	try {
		const lib = openLib();
		const rc = lib.symbols.bl_init();
		if (rc !== 0) {
			throw new Error(`bl_init returned ${rc}`);
		}
		_lib = lib;
		// Best-effort cleanup at exit — lightpanda_dom uses an internal arena
		// allocator, so missing this isn't fatal but avoids a leak warning.
		const cleanup = () => {
			try {
				lib.symbols.bl_deinit();
			} catch {
				/* swallow */
			}
		};
		process.on("exit", cleanup);
		return lib;
	} catch (err) {
		_initFailed = true;
		_initError = err instanceof Error ? err : new Error(String(err));
		throw _initError;
	}
}

// ---------------------------------------------------------------------------
// High-level wrappers
// ---------------------------------------------------------------------------

/** Encodes a string as a UTF-8 Buffer ready for FFI passing. */
function utf8(s: string): Buffer {
	return Buffer.from(s, "utf8");
}

/**
 * A live element handle owned by a `ZigSelection`.  Lifetime is bounded by the
 * selection that produced it — call `destroy()` when done, or rely on the
 * parent selection / document being destroyed.
 */
export class ZigElement {
	/** @internal */
	#handle: Pointer | null;

	/** @internal */
	constructor(handle: Pointer) {
		this.#handle = handle;
	}

	/** Returns the element's text content (concatenated text nodes). */
	textContent(): string {
		this.#assertOpen();
		const out = new Uint8Array(BL_STRING_SIZE);
		ensureInit().symbols.bl_sel_text_into(this.#handle!, ptr(out));
		return readBlString(out);
	}

	/** Returns the element's `innerHTML`. */
	innerHTML(): string {
		this.#assertOpen();
		const out = new Uint8Array(BL_STRING_SIZE);
		ensureInit().symbols.bl_sel_html_into(this.#handle!, ptr(out));
		return readBlString(out);
	}

	/** Returns the element's `outerHTML`. */
	outerHTML(): string {
		this.#assertOpen();
		const out = new Uint8Array(BL_STRING_SIZE);
		ensureInit().symbols.bl_sel_outer_html_into(this.#handle!, ptr(out));
		return readBlString(out);
	}

	/** Returns the element's tag name in lowercase. */
	tagName(): string {
		this.#assertOpen();
		const out = new Uint8Array(BL_STRING_SIZE);
		ensureInit().symbols.bl_sel_tag_name_into(this.#handle!, ptr(out));
		return readBlString(out);
	}

	/**
	 * Returns the value of the named attribute, or an empty string if the
	 * attribute is missing.  (Zig wrapper does not currently distinguish
	 * "absent" from "empty" — callers that need null-handling should compare
	 * the returned string and inspect surrounding state.)
	 */
	getAttribute(name: string): string {
		this.#assertOpen();
		const nameBuf = utf8(name);
		const out = new Uint8Array(BL_STRING_SIZE);
		ensureInit().symbols.bl_sel_attr_into(
			this.#handle!,
			ptr(nameBuf),
			nameBuf.byteLength,
			ptr(out),
		);
		return readBlString(out);
	}

	/** Releases the underlying handle.  Idempotent. */
	destroy(): void {
		if (!this.#handle) return;
		ensureInit().symbols.bl_sel_destroy(this.#handle);
		this.#handle = null;
	}

	#assertOpen(): void {
		if (!this.#handle) throw new Error("ZigElement: handle has been destroyed");
	}
}

/**
 * A live selection handle (matches of one CSS query).  Iterate via `at(i)` or
 * `forEach(...)`.  Each `ZigElement` returned by `at()` must be destroyed
 * separately (or simply destroy the parent selection / document).
 */
export class ZigSelection {
	/** @internal */
	#handle: Pointer | null;
	/** @internal */
	#count: number;

	/** @internal */
	constructor(handle: Pointer, count: number) {
		this.#handle = handle;
		this.#count = count;
	}

	/** Number of matched elements. */
	get count(): number {
		return this.#count;
	}

	/** Returns the i-th matched element, or `null` if out of range. */
	at(i: number): ZigElement | null {
		this.#assertOpen();
		if (i < 0 || i >= this.#count) return null;
		const elPtr = ensureInit().symbols.bl_sel_at(this.#handle!, BigInt(i));
		if (!elPtr) return null;
		return new ZigElement(elPtr);
	}

	/**
	 * Materialises every matched element into an array.  Caller is responsible
	 * for calling `destroy()` on each element (or destroying the parent
	 * selection / document).
	 */
	toArray(): ZigElement[] {
		const out: ZigElement[] = [];
		for (let i = 0; i < this.#count; i++) {
			const el = this.at(i);
			if (el) out.push(el);
		}
		return out;
	}

	/** Releases the underlying selection.  Idempotent. */
	destroy(): void {
		if (!this.#handle) return;
		ensureInit().symbols.bl_sel_destroy(this.#handle);
		this.#handle = null;
	}

	#assertOpen(): void {
		if (!this.#handle) throw new Error("ZigSelection: handle has been destroyed");
	}
}

/**
 * Owns a parsed HTML document.  Selections derived from it are valid until
 * `destroy()` is called.
 */
export class ZigDoc {
	/** @internal */
	#handle: Pointer | null;

	/** Underlying HTML source — kept for callers that need raw access. */
	readonly html: string;

	/** @internal */
	constructor(handle: Pointer, html: string) {
		this.#handle = handle;
		this.html = html;
	}

	/**
	 * Runs a CSS query and returns a `ZigSelection`.  An empty selector or no
	 * matches returns a selection with `count === 0`.
	 */
	find(selector: string): ZigSelection {
		this.#assertOpen();
		const lib = ensureInit();
		const sel = utf8(selector);
		const handle = lib.symbols.bl_doc_find(this.#handle!, ptr(sel), sel.byteLength);
		if (!handle) {
			// Empty selector / parse error — emulate empty selection.
			return new ZigSelection(0 as unknown as Pointer, 0);
		}
		const count = Number(lib.symbols.bl_sel_count(handle));
		return new ZigSelection(handle, count);
	}

	/** Convenience: first matching element or `null`. */
	querySelector(selector: string): ZigElement | null {
		const sel = this.find(selector);
		try {
			return sel.at(0);
		} finally {
			// Note: we don't destroy the parent selection here because the element
			// at(0) may share its lifetime; safe pattern is to let the doc destroy
			// cascade-clean.  Caller can destroy the element and the doc.
		}
	}

	/** Convenience: all matching elements (materialised). */
	querySelectorAll(selector: string): ZigElement[] {
		const sel = this.find(selector);
		try {
			return sel.toArray();
		} finally {
			// Same arena-lifetime caveat as above.
		}
	}

	/** Releases the underlying document and any selections derived from it. */
	destroy(): void {
		if (!this.#handle) return;
		ensureInit().symbols.bl_doc_destroy(this.#handle);
		this.#handle = null;
	}

	#assertOpen(): void {
		if (!this.#handle) throw new Error("ZigDoc: handle has been destroyed");
	}
}

/**
 * Parses a UTF-8 HTML string and returns an owning `ZigDoc`.  Throws if the
 * library is unavailable or the parse fails.
 */
export function parseHtml(html: string): ZigDoc {
	const lib = ensureInit();
	const buf = utf8(html);
	const handle = lib.symbols.bl_doc_from_html(ptr(buf), buf.byteLength);
	if (!handle) {
		throw new Error("zigquery: bl_doc_from_html returned null (parse failed)");
	}
	return new ZigDoc(handle, html);
}
