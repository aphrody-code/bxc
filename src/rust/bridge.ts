import { CString, dlopen, FFIType, ptr, suffix } from "bun:ffi";
import { join } from "path";

/**
 * Resolves the rust-bridge cdylib path.
 *
 * `cargo build` emits a platform-specific shared library:
 *   - Linux   : libbunlight_rust_bridge.so
 *   - macOS   : libbunlight_rust_bridge.dylib
 *   - Windows : bunlight_rust_bridge.dll  (no `lib` prefix on the MSVC toolchain)
 *
 * `suffix` from bun:ffi is "so" | "dylib" | "dll" for the current platform.
 * Override with BUNLIGHT_RUST_BRIDGE_LIB (absolute path).
 */
function resolveRustBridgePath(): string {
	const envOverride = process.env["BUNLIGHT_RUST_BRIDGE_LIB"];
	if (envOverride) return envOverride;

	const repoRoot = join(import.meta.dir, "..", "..");
	const targetDir = join(repoRoot, "rust-bridge", "target", "release");
	const name =
		process.platform === "win32"
			? `bunlight_rust_bridge.${suffix}`
			: `libbunlight_rust_bridge.${suffix}`;
	return join(targetDir, name);
}

const libPath = resolveRustBridgePath();

const lib = dlopen(libPath, {
	markdown_to_html: {
		args: [FFIType.ptr],
		returns: FFIType.ptr,
	},
	free_string: {
		args: [FFIType.ptr],
		returns: FFIType.void,
	},
});

export function markdownToHtml(md: string): string {
	const buf = Buffer.from(md + "\0");
	const resultPtr = lib.symbols.markdown_to_html(ptr(buf));
	if (!resultPtr) return "";

	const result = new CString(resultPtr).toString();

	lib.symbols.free_string(resultPtr);
	return result;
}
