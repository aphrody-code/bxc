// Bxc — standalone build.zig for liblightpanda.{so,a}
//
// This build script can be run from the bxc/src/zig-bridge/ directory
// but the RECOMMENDED workflow is to work directly from lightpanda-src/
// after applying the patch:
//
//   cd lightpanda-src
//   git apply ../../bxc/patches/001-cdylib-target.patch
//   zig build -Dno_v8=true -Doptimize=ReleaseFast lib
//
// This standalone build.zig exists as a reference and for CI environments
// where the lightpanda source is available but the patch is already applied.
//
// It re-uses the Lightpanda build.zig as a dependency via `b.dependency`.
// The lp_src path must point to the Lightpanda tree with the patch applied.
//
// Prerequisites:
//   - Zig 0.15.x
//   - cargo (Rust) on PATH (for html5ever)
//   - lightpanda-src/ with 001-cdylib-target.patch applied
//
// Usage:
//   From bxc/src/zig-bridge/:
//     zig build -Dlp_src=../../../lightpanda-src -Doptimize=ReleaseFast lib
//
// Zig version: 0.15.x

const std = @import("std");
const Build = std.Build;

pub fn build(b: *Build) !void {
    const target   = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Path to the patched Lightpanda source tree.
    const lp_src = b.option(
        []const u8,
        "lp_src",
        "Path to the patched Lightpanda source tree",
    ) orelse "../../../lightpanda-src";

    // ---------------------------------------------------------------------------
    // Lightpanda as a path dependency.
    //
    // b.dependency works when lp_src/build.zig.zon is present (it always is).
    // We pass no_v8=true so Lightpanda's build.zig skips V8 linking.
    // ---------------------------------------------------------------------------
    const lp_dep = b.dependency("lightpanda", .{
        .target   = target,
        .optimize = optimize,
        .no_v8    = true,
    });

    // The patched Lightpanda exposes a "lightpanda" module from its build graph.
    const lp_mod = lp_dep.module("lightpanda");

    // ---------------------------------------------------------------------------
    // exports.zig — C ABI entry point
    // ---------------------------------------------------------------------------
    const bridge_src = b.path(".");

    const lib_step = b.step("lib", "Build liblightpanda.{so,a}");

    // Shared library
    {
        const exports_mod = b.createModule(.{
            .root_source_file = bridge_src.path(b, "exports.zig"),
            .target   = target,
            .optimize = optimize,
            .link_libc = true,
        });
        exports_mod.addImport("lightpanda", lp_mod);

        const shared = b.addLibrary(.{
            .name     = "lightpanda",
            .linkage  = .dynamic,
            .root_module = exports_mod,
            .use_llvm = true,
        });
        lib_step.dependOn(&b.addInstallArtifact(shared, .{}).step);
    }

    // Static library
    {
        const exports_mod = b.createModule(.{
            .root_source_file = bridge_src.path(b, "exports.zig"),
            .target   = target,
            .optimize = optimize,
            .link_libc = true,
        });
        exports_mod.addImport("lightpanda", lp_mod);

        const static = b.addLibrary(.{
            .name     = "lightpanda",
            .linkage  = .static,
            .root_module = exports_mod,
            .use_llvm = true,
        });
        lib_step.dependOn(&b.addInstallArtifact(static, .{}).step);
    }

    b.default_step.dependOn(lib_step);

    _ = lp_src; // referenced above via b.dependency
}
