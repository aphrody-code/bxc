// Bunlight — js/stub.zig
//
// Drop-in replacement for src/browser/js/js.zig when -Dno_v8=true.
//
// This file provides the minimum type surface required to compile the Zig DOM
// core (Frame, Page, Factory, webapi/*) without linking V8.
//
// Design rules:
//   1. Every type is a zero-size struct or an opaque wrapper around *anyopaque.
//      No real V8 handles, no isolate pointers.
//   2. Every method that JS-mode uses panics with "no_v8 stub" in debug
//      builds, or is unreachable in release builds.  The DOM-only code paths
//      must never call these methods at runtime.
//   3. Field types must match what Frame/Page/Document expect so the struct
//      layouts remain compatible.

const std = @import("std");

// v8 C-API namespace stub.  The real js.zig does `pub const v8 = @import("v8").c;`
// which pulls in hundreds of C function declarations.  We only need the types
// that appear in struct fields of Frame/Page/Session etc.
pub const v8 = struct {
    // These types are used as field types in v8-side structs.  Zero-size is
    // fine because no code in the DOM-only path will ever store or read them.
    pub const Global = extern struct { _opaque: usize = 0 };
    pub const Isolate = opaque {};
    pub const Context_ = opaque {};
};

// ---------------------------------------------------------------------------
// Primitive JS value stubs
// ---------------------------------------------------------------------------

pub const Value = struct {
    pub fn toStringSlice(self: *const Value) ![]const u8 {
        _ = self;
        return noV8("Value.toStringSlice");
    }
    pub fn toStringSliceWithAlloc(self: *const Value, _: std.mem.Allocator) ![]const u8 {
        _ = self;
        return noV8("Value.toStringSliceWithAlloc");
    }
};

pub const String = struct {
    pub fn init(_: []const u8) String {
        return .{};
    }
};

pub const Number = struct {
    pub fn value(_: *const Number) f64 {
        return 0;
    }
};

pub const Integer = struct {
    pub fn value(_: *const Integer) i64 {
        return 0;
    }
};

pub const BigInt = struct {};

pub const RegExp = struct {};

pub const ArrayBuffer = struct {
    data: [*]const u8 = undefined,
    byte_length: usize = 0,
};

pub const ArrayType = enum(u8) {
    int8 = 0,
    uint8,
    uint8_clamped,
    int16,
    uint16,
    int32,
    uint32,
    float32,
    float64,
    bigint64,
    biguint64,
};

pub const NullableString = struct {
    value: ?[]const u8 = null,
};

pub const Undefined = struct {};

pub const Exception = struct {
    message: []const u8 = "",
};

// ---------------------------------------------------------------------------
// Object / Function stubs — these appear as field types (e.g. ?js.Object.Global)
// ---------------------------------------------------------------------------

pub const Object = struct {
    pub const Global = struct {
        _inner: usize = 0,

        pub fn deinit(_: *Global) void {}
    };

    pub const Temp = struct {
        _inner: usize = 0,

        pub fn deinit(_: *Temp) void {}
    };

    pub fn global(_: *const Object) !Global {
        return noV8("Object.global");
    }
};

pub const Function = struct {
    pub const Global = struct {
        _inner: usize = 0,

        pub fn deinit(_: *Global) void {}
        pub fn toLocal(_: *const Global, _: *const Local) Function {
            return .{};
        }
        pub fn isEqual(_: *const Global, _: *const Global) bool {
            return false;
        }
    };

    pub const Temp = struct {
        _inner: usize = 0,

        pub fn deinit(_: *Temp) void {}
    };

    pub fn persist(_: *const Function) !Global {
        return noV8("Function.persist");
    }

    pub fn persistWithThis(_: *const Function, _: anytype) !Global {
        return noV8("Function.persistWithThis");
    }

    pub fn temp(_: *const Function) !Temp {
        return noV8("Function.temp");
    }

    pub fn tempWithThis(_: *const Function, _: anytype) !Temp {
        return noV8("Function.tempWithThis");
    }
};

pub const Promise = struct {
    pub const Global = struct {
        _inner: usize = 0,
        pub fn deinit(_: *Global) void {}
    };
};

pub const PromiseResolver = struct {
    pub fn resolve(_: *PromiseResolver, _: anytype) !void {
        return noV8("PromiseResolver.resolve");
    }
    pub fn reject(_: *PromiseResolver, _: anytype) !void {
        return noV8("PromiseResolver.reject");
    }
};

pub const PromiseRejection = struct {
    pub fn promise(_: *PromiseRejection) Promise {
        return .{};
    }
};

pub const Array = struct {
    pub fn length(_: *const Array) u32 {
        return 0;
    }
};

pub const Module = struct {};

// ---------------------------------------------------------------------------
// Execution context stubs (used in addEventListener, dispatchEvent, etc.)
// ---------------------------------------------------------------------------

pub const Execution = struct {
    pub fn local(_: *const Execution) *Local {
        noV8Panic("Execution.local");
    }
};

pub const Local = struct {
    pub const Scope = struct {
        local: Local = .{},
        pub fn deinit(_: *Scope) void {}
    };

    pub fn exec(_: *const Local, _: []const u8, _: []const u8) !Value {
        return noV8("Local.exec");
    }
};

pub const TryCatch = struct {
    pub fn init(_: *TryCatch, _: *const Local) void {}
    pub fn deinit(_: *TryCatch) void {}
    pub fn caughtOrError(_: *TryCatch, _: std.mem.Allocator, _: anyerror) ![]const u8 {
        return noV8("TryCatch.caughtOrError");
    }
};

pub const HandleScope = struct {
    pub fn init(_: *HandleScope, _: *Isolate) void {}
    pub fn deinit(_: *HandleScope) void {}
};

// ---------------------------------------------------------------------------
// Isolate / Context / Env stubs (used in Browser/Page init)
// ---------------------------------------------------------------------------

pub const Isolate = struct {
    pub fn init(_: anytype) !Isolate {
        return noV8("Isolate.init");
    }
    pub fn deinit(_: *Isolate) void {}
};

pub const Context = struct {
    // Frame.js field type is *Context.
    // In DOM-only mode Frame.js is never dereferenced, so a dangling pointer
    // is fine as long as no code path in the DOM core reads it.
    pub fn localScope(_: *Context, _: *Local.Scope) void {}
    pub fn enter(_: *Context, _: anytype) bool {
        return false;
    }
    pub fn setOrigin(_: *Context, _: ?[]const u8) !void {}

    pub const Scheduler = struct {
        pub fn add(_: *Scheduler, _: anytype, _: anytype) !void {}
    };
    scheduler: Scheduler = .{},
};

pub const Env = struct {
    pub const InitOpts = struct {};

    pub fn init(_: anytype, _: InitOpts) !Env {
        return .{};
    }

    pub fn deinit(_: *Env) void {}

    pub fn createContext(_: *Env, _: anytype, _: anytype) !*Context {
        // Never called in DOM-only paths (no JS execution).
        // Provide a stub allocation so Frame.init can store frame.js.
        noV8Panic("Env.createContext");
    }

    pub fn destroyContext(_: *Env, _: *Context) void {}
};

// ---------------------------------------------------------------------------
// Inspector / Snapshot / Platform stubs
// ---------------------------------------------------------------------------

pub const Inspector = struct {};

pub const Snapshot = struct {
    pub fn init(_: anytype) !Snapshot {
        return noV8("Snapshot.init");
    }
    pub fn deinit(_: *Snapshot) void {}
};

pub const Platform = struct {
    pub fn init() !Platform {
        return noV8("Platform.init");
    }
    pub fn deinit(_: *Platform) void {}
};

// ---------------------------------------------------------------------------
// Identity / Origin stubs (used in Page for same-origin checks)
// ---------------------------------------------------------------------------

pub const Identity = struct {};

pub const Origin = struct {
    pub fn deinit(_: *Origin) void {}
};

pub const Caller = struct {
    pub fn local(_: *const Caller) *const Local {
        noV8Panic("Caller.local");
    }
};

// ---------------------------------------------------------------------------
// bridge stub — the bridge module generates JS bindings from Zig types.
// In DOM-only mode no bindings are generated; the accessor/function macros
// must still type-check, so we provide no-op implementations.
// ---------------------------------------------------------------------------

pub const bridge = struct {
    pub fn Builder(comptime _: type) type {
        return struct {};
    }

    pub fn accessor(_: anytype, _: anytype, _: anytype) void {}
    pub fn function(_: anytype, _: anytype) void {}
    pub fn setter(_: anytype, _: anytype) void {}
};

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

/// Called when DOM-only code accidentally reaches a V8 code path.
/// Returns `error.NoV8Stub` so callers can propagate the error union.
fn noV8(comptime ctx: []const u8) error{NoV8Stub} {
    std.log.err("no_v8 stub called: " ++ ctx, .{});
    return error.NoV8Stub;
}

/// Variant that diverges (noreturn) — used where the return type is not an
/// error union and we must still satisfy the type system.
fn noV8Panic(comptime ctx: []const u8) noreturn {
    @panic("no_v8 stub called: " ++ ctx);
}

pub fn Bridge(comptime T: type) type {
    return bridge.Builder(T);
}
