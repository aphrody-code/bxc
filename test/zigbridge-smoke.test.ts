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
 * Bxc — zigbridge smoke test
 *
 * Tests the C ABI exported by liblightpanda_dom.{so,dylib} (backed by
 * zigquery).  Build the library before running:
 *
 *   cd vendor/zigquery-wrapper && zig build -Doptimize=ReleaseFast
 *
 * Run:
 *   bun test test/zigbridge-smoke.test.ts
 *
 * The test uses bun:ffi (dlopen) so it only runs on Linux/macOS and requires
 * the built library in the expected output path.
 */

import { dlopen, FFIType, ptr, read, suffix } from "bun:ffi";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Pointer } from "bun:ffi";

// ---------------------------------------------------------------------------
// Library path resolution
// ---------------------------------------------------------------------------

const LIB_DIR = join(import.meta.dir, "../vendor/zigquery-wrapper/zig-out/lib");
const LIB_NAME = `liblightpanda_dom.${suffix}`;
const LIB_PATH = join(LIB_DIR, LIB_NAME);

// ---------------------------------------------------------------------------
// BlString layout (must match exports.zig extern struct)
//
//   data: [*]const u8   — 8 bytes (ptr)
//   len:  usize         — 8 bytes
//   cap:  usize         — 8 bytes
//   Total: 24 bytes on 64-bit
// ---------------------------------------------------------------------------

const BL_STRING_SIZE = 24; // bytes

/**
 * Read a BlString from a DataView at a given byte offset.
 * Returns the UTF-8 text and whether the caller should call bl_string_free.
 */
function readBlString(view: DataView, offset = 0): string {
	const dataPtrLow = view.getUint32(offset + 0, true);
	const dataPtrHigh = view.getUint32(offset + 4, true);
	const len = Number(view.getBigUint64(offset + 8, true));
	// cap is at offset+16 but we don't need it for reading

	if (len === 0) return "";

	// Reconstruct the native pointer (works on 64-bit little-endian hosts).
	const dataPtr = (dataPtrLow +
		dataPtrHigh * 0x1_0000_0000) as unknown as Pointer;

	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = read.u8(dataPtr, i);
	}
	return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// FFI symbol declarations
// ---------------------------------------------------------------------------

type Lib = ReturnType<typeof openLib>;

function openLib() {
	return dlopen(LIB_PATH, {
		// lifecycle
		bl_init: { returns: FFIType.i32 },
		bl_deinit: { returns: "void" },

		// document
		bl_doc_from_html: {
			args: [FFIType.ptr, FFIType.u64],
			returns: FFIType.ptr,
		},
		bl_doc_destroy: {
			args: [FFIType.ptr],
			returns: "void",
		},

		// selection
		bl_doc_find: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
			returns: FFIType.ptr,
		},
		bl_sel_count: {
			args: [FFIType.ptr],
			returns: FFIType.u64,
		},
		bl_sel_at: {
			args: [FFIType.ptr, FFIType.u64],
			returns: FFIType.ptr,
		},
		bl_sel_destroy: {
			args: [FFIType.ptr],
			returns: "void",
		},

		// _into wrappers (Phase 1.5) — bun:ffi cannot return BlString by value.
		// We pass an out-pointer (Uint8Array of 24 bytes) and the wrapper writes through it.
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
			args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
			returns: "void",
		},
		bl_sel_tag_name_into: {
			args: [FFIType.ptr, FFIType.ptr],
			returns: "void",
		},

		// memory management
		bl_string_free: {
			args: [FFIType.ptr],
			returns: "void",
		},

		// error reporting
		bl_last_error: {
			returns: FFIType.cstring,
		},
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let lib: Lib | undefined;
let _symbols: Lib["symbols"] | undefined;

const hasLib = await Bun.file(LIB_PATH).exists();

describe.skipIf(!hasLib)("zigbridge smoke test — liblightpanda_dom", () => {
	beforeAll(async () => {
		if (!hasLib) {
			console.log(`[skip] Library not found at ${LIB_PATH}. Build it first.`);
			return;
		}
		lib = openLib();
		_symbols = lib.symbols;
	});

	afterAll(() => {
		if (_symbols) _symbols!.bl_deinit();
		if (lib) lib.close();
	});

	// -------------------------------------------------------------------------
	test("bl_init returns 0", () => {
		const rc = _symbols!.bl_init();
		expect(rc).toBe(0);
	});

	// -------------------------------------------------------------------------
	test("parse HTML document — returns non-null handle", () => {
		const html = new TextEncoder().encode("<h1 id='title'>Hi</h1><p>World</p>");
		const doc = _symbols!.bl_doc_from_html(ptr(html), BigInt(html.byteLength));
		expect(doc).not.toBeNull();
		// cleanup
		_symbols!.bl_doc_destroy(doc!);
	});

	// -------------------------------------------------------------------------
	test("find h1 selector — count == 1", () => {
		const html = new TextEncoder().encode(
			"<html><body><h1>Hi</h1></body></html>",
		);
		const doc = _symbols!.bl_doc_from_html(ptr(html), BigInt(html.byteLength));
		expect(doc).not.toBeNull();

		const selStr = new TextEncoder().encode("h1");
		const sel = _symbols!.bl_doc_find(
			doc!,
			ptr(selStr),
			BigInt(selStr.byteLength),
		);
		expect(sel).not.toBeNull();
		expect(Number(_symbols!.bl_sel_count(sel!))).toBe(1);

		_symbols!.bl_sel_destroy(sel!);
		_symbols!.bl_doc_destroy(doc!);
	});

	// -------------------------------------------------------------------------
	// Phase 1.5: BlString accessors via _into() out-pointer wrappers.
	test("bl_sel_text_into returns 'Hi'", () => {
		const html = new TextEncoder().encode("<h1 id='title'>Hi</h1>");
		const doc = _symbols!.bl_doc_from_html(ptr(html), BigInt(html.byteLength));
		expect(doc).not.toBeNull();

		const selStr = new TextEncoder().encode("h1");
		const sel = _symbols!.bl_doc_find(
			doc!,
			ptr(selStr),
			BigInt(selStr.byteLength),
		);
		expect(sel).not.toBeNull();
		expect(Number(_symbols!.bl_sel_count(sel!))).toBe(1);

		const el = _symbols!.bl_sel_at(sel!, 0n);
		expect(el).not.toBeNull();

		const out = new Uint8Array(BL_STRING_SIZE);
		_symbols!.bl_sel_text_into(el!, ptr(out));
		const text = readBlString(new DataView(out.buffer));
		// Skip bl_string_free for arena-owned strings (cap=0 → no-op).
		// FFI binding for by-value BlString needs a separate _ptr wrapper (TODO).

		expect(text).toBe("Hi");

		_symbols!.bl_sel_destroy(el!);
		_symbols!.bl_sel_destroy(sel!);
		_symbols!.bl_doc_destroy(doc!);
	});

	// -------------------------------------------------------------------------
	test("bl_sel_attr_into returns id value", () => {
		const html = new TextEncoder().encode('<h1 id="title">Hi</h1>');
		const doc = _symbols!.bl_doc_from_html(ptr(html), BigInt(html.byteLength))!;
		const selStr = new TextEncoder().encode("h1");
		const sel = _symbols!.bl_doc_find(
			doc,
			ptr(selStr),
			BigInt(selStr.byteLength),
		)!;
		const el = _symbols!.bl_sel_at(sel, 0n)!;

		const attrName = new TextEncoder().encode("id");
		const out = new Uint8Array(BL_STRING_SIZE);
		_symbols!.bl_sel_attr_into(
			el,
			ptr(attrName),
			BigInt(attrName.byteLength),
			ptr(out),
		);
		const attrVal = readBlString(new DataView(out.buffer));
		// Skip bl_string_free for arena-owned strings (cap=0 → no-op).
		// FFI binding for by-value BlString needs a separate _ptr wrapper (TODO).

		expect(attrVal).toBe("title");

		_symbols!.bl_sel_destroy(el);
		_symbols!.bl_sel_destroy(sel);
		_symbols!.bl_doc_destroy(doc!);
	});

	// -------------------------------------------------------------------------
	test("bl_sel_tag_name_into returns lowercase tag", () => {
		const html = new TextEncoder().encode("<div><span>x</span></div>");
		const doc = _symbols!.bl_doc_from_html(ptr(html), BigInt(html.byteLength))!;
		const selStr = new TextEncoder().encode("span");
		const sel = _symbols!.bl_doc_find(
			doc,
			ptr(selStr),
			BigInt(selStr.byteLength),
		)!;
		const el = _symbols!.bl_sel_at(sel, 0n)!;

		const out = new Uint8Array(BL_STRING_SIZE);
		_symbols!.bl_sel_tag_name_into(el, ptr(out));
		const tag = readBlString(new DataView(out.buffer));
		// Skip bl_string_free for arena-owned strings (cap=0 → no-op).
		// FFI binding for by-value BlString needs a separate _ptr wrapper (TODO).

		expect(tag).toBe("span");

		_symbols!.bl_sel_destroy(el);
		_symbols!.bl_sel_destroy(sel);
		_symbols!.bl_doc_destroy(doc!);
	});

	// -------------------------------------------------------------------------
	test("empty selector result — count == 0, bl_sel_at returns null", () => {
		const html = new TextEncoder().encode("<div></div>");
		const doc = _symbols!.bl_doc_from_html(ptr(html), BigInt(html.byteLength))!;
		const selStr = new TextEncoder().encode("span");
		const sel = _symbols!.bl_doc_find(
			doc,
			ptr(selStr),
			BigInt(selStr.byteLength),
		)!;

		expect(Number(_symbols!.bl_sel_count(sel))).toBe(0);
		expect(_symbols!.bl_sel_at(sel, 0n)).toBeNull();

		_symbols!.bl_sel_destroy(sel);
		_symbols!.bl_doc_destroy(doc!);
	});

	// -------------------------------------------------------------------------
	test("cleanup correct — no crash after destroy sequence", () => {
		// Verifies that destroy order (sel before doc) does not cause issues.
		const html = new TextEncoder().encode("<p>ok</p>");
		const doc = _symbols!.bl_doc_from_html(ptr(html), BigInt(html.byteLength))!;
		const selStr = new TextEncoder().encode("p");
		const sel = _symbols!.bl_doc_find(
			doc,
			ptr(selStr),
			BigInt(selStr.byteLength),
		)!;
		const el = _symbols!.bl_sel_at(sel, 0n)!;

		_symbols!.bl_sel_destroy(el);
		_symbols!.bl_sel_destroy(sel);
		_symbols!.bl_doc_destroy(doc);
		// If we reach here without crash the test passes.
		expect(true).toBe(true);
	});
});
