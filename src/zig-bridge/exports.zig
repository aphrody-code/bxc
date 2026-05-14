// Bunlight Phase 1 — C ABI exports for liblightpanda (DOM-only, no V8)
//
// Root source file for the `lib` build target added by
// bunlight/patches/001-cdylib-target.patch.
//
// Prerequisites (the patch adds these to Lightpanda):
//   - Browser.parseStatic(html) -> !*Frame
//   - Frame.parseHtmlDocument(html) -> !void
//   - lp.selector  re-export in lightpanda.zig
//   - src/browser/js/stub.zig  (V8 no-op stub)
//   - build flag -Dno_v8=true disables V8 link
//
// Ownership model
// ───────────────
//   Every BlString returned to the C caller is GPA-allocated; free with
//   bl_string_free().
//   Every *BlElement from bl_query_selector must be freed with
//   bl_element_free().
//   The array from bl_query_selector_all must be freed with
//   bl_array_free(arr, count).
//   bl_document_destroy() frees all DOM nodes via the underlying arena —
//   after this call any *BlElement derived from the document is invalid.
//
// Thread safety: none — serialize access externally or use one document per
// thread.

const std = @import("std");

// `lightpanda` is the module injected by the build script.
// It resolves to src/lightpanda.zig (with the patch applied).
const lp = @import("lightpanda");

// Selector module re-exported from lightpanda.zig by the patch.
// The patch adds:
//   pub const selector    = @import("browser/webapi/selector/Selector.zig");
//   pub const DomNode     = @import("browser/webapi/Node.zig");
//   pub const DomElement  = @import("browser/webapi/Element.zig");
const Selector = lp.selector;
const DomElement = lp.DomElement; // webapi/Element.zig
const DomNode = lp.DomNode;       // webapi/Node.zig

// ---------------------------------------------------------------------------
// Global allocator
// ---------------------------------------------------------------------------
var gpa: std.heap.GeneralPurposeAllocator(.{}) = .{};

// ---------------------------------------------------------------------------
// Thread-local error buffer — avoids allocation on the error path
// ---------------------------------------------------------------------------
var tl_error_buf: [512]u8 = undefined;
var tl_error_len: usize = 0;

fn setError(comptime fmt: []const u8, args: anytype) void {
    const written = std.fmt.bufPrint(&tl_error_buf, fmt, args) catch blk: {
        const msg = "(error message truncated)";
        @memcpy(tl_error_buf[0..msg.len], msg);
        break :blk tl_error_buf[0..msg.len];
    };
    tl_error_len = written.len;
    if (tl_error_len < tl_error_buf.len) tl_error_buf[tl_error_len] = 0;
}

fn clearError() void {
    tl_error_len = 0;
    tl_error_buf[0] = 0;
}

// ---------------------------------------------------------------------------
// Opaque C types
// ---------------------------------------------------------------------------

/// Opaque browser instance.  In DOM-only mode holds just an allocator handle.
pub const BlBrowser = opaque {};

/// Opaque parsed HTML document.  Owns all DOM nodes via an arena.
pub const BlDocument = opaque {};

/// Opaque DOM element.  Valid until bl_document_destroy() is called on the
/// owning document.
pub const BlElement = opaque {};

// ---------------------------------------------------------------------------
// BlString — owned UTF-8 string returned to the C caller
// ---------------------------------------------------------------------------

/// An owned UTF-8 string.  Must be freed by the caller with bl_string_free().
///
/// The layout is `extern` for ABI stability.  `capacity` is internal — treat
/// it as opaque from C.
pub const BlString = extern struct {
    /// Pointer to UTF-8 bytes.  Always non-null (empty strings use len == 0).
    data: [*]const u8,
    /// Number of UTF-8 bytes, excluding a null terminator.
    len: usize,
    /// Allocated byte count including the null terminator.  Opaque to C.
    capacity: usize,
};

// ---------------------------------------------------------------------------
// Internal concrete types
// ---------------------------------------------------------------------------

/// BrowserImpl: bookkeeping for one browser context.
const BrowserImpl = struct {
    allocator: std.mem.Allocator,
};

/// DocumentImpl: wraps a parsed document tree.
///
/// The Lightpanda stack is:
///   App → Browser → Session → Page → Frame (+ DOM nodes in Page.frame_arena)
///
/// bl_parse_html allocates App and Browser on the GPA.  The Session, Page,
/// and Frame are allocated inside Browser/Session's own arena pools.
/// Destroying the browser cascades through the whole stack.
const DocumentImpl = struct {
    app: *lp.App,
    browser: *lp.Browser,
    // Frame is the root browsing context returned by Browser.parseStatic().
    // It is owned by the Page embedded inside the Session; do not free it
    // directly — it is freed when the browser is destroyed.
    frame: *lp.Frame,
};

/// ElementImpl: thin GPA-allocated wrapper around a Lightpanda Element pointer.
/// DomElement is webapi/Element.zig re-exported via lp.DomElement (patch).
const ElementImpl = struct {
    /// Concrete Lightpanda element.  Owned by the document arena; do NOT free.
    element: *DomElement,
    /// Back-pointer to the document for methods that need frame.call_arena.
    doc: *DocumentImpl,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn blStringAlloc(allocator: std.mem.Allocator, src: []const u8) error{OutOfMemory}!BlString {
    const capacity = src.len + 1;
    const buf = try allocator.alloc(u8, capacity);
    @memcpy(buf[0..src.len], src);
    buf[src.len] = 0;
    return .{ .data = buf.ptr, .len = src.len, .capacity = capacity };
}

/// Sentinel BlString returned on error (capacity == 0, bl_string_free is no-op).
fn blStringErr() BlString {
    return .{ .data = "".ptr, .len = 0, .capacity = 0 };
}

// ---------------------------------------------------------------------------
// C ABI — init / cleanup
// ---------------------------------------------------------------------------

/// Initialize the library.
///
/// Must be called once before any other bl_* function.
/// Returns 0 on success, -1 on failure.
/// Safe to call multiple times (subsequent calls are no-ops).
export fn bl_init() c_int {
    clearError();
    return 0;
}

/// Allocate a browser context.  Returns null on OOM.
/// Destroy with bl_browser_destroy().
export fn bl_browser_create() ?*BlBrowser {
    clearError();
    const alloc = gpa.allocator();
    const impl = alloc.create(BrowserImpl) catch {
        setError("bl_browser_create: OOM", .{});
        return null;
    };
    impl.* = .{ .allocator = alloc };
    return @ptrCast(impl);
}

/// Destroy a browser context created by bl_browser_create().
export fn bl_browser_destroy(b: *BlBrowser) void {
    clearError();
    const impl: *BrowserImpl = @ptrCast(@alignCast(b));
    gpa.allocator().destroy(impl);
}

// ---------------------------------------------------------------------------
// C ABI — HTML parsing
// ---------------------------------------------------------------------------

/// Parse an HTML byte slice and return an opaque document handle.
/// Returns null on error; call bl_last_error() for the reason.
/// The caller must eventually call bl_document_destroy().
///
///   html      — pointer to HTML bytes (need not be null-terminated)
///   html_len  — byte length of the HTML input
export fn bl_parse_html(html: [*]const u8, html_len: usize) ?*BlDocument {
    clearError();
    const html_slice = html[0..html_len];
    const alloc = gpa.allocator();

    const doc = alloc.create(DocumentImpl) catch {
        setError("bl_parse_html: OOM allocating DocumentImpl", .{});
        return null;
    };
    var cleanup_doc = true;
    defer if (cleanup_doc) alloc.destroy(doc);

    // App.init initialises the arena pool, network layer, and (in DOM-only
    // mode) the stub V8 platform.
    const config = lp.Config{};
    doc.app = lp.App.init(alloc, &config) catch |err| {
        setError("bl_parse_html: App.init: {s}", .{@errorName(err)});
        return null;
    };
    var cleanup_app = true;
    defer if (cleanup_app) doc.app.deinit();

    // Allocate and initialise the Browser.
    doc.browser = alloc.create(lp.Browser) catch {
        setError("bl_parse_html: OOM allocating Browser", .{});
        return null;
    };
    var cleanup_browser_alloc = true;
    defer if (cleanup_browser_alloc) alloc.destroy(doc.browser);

    doc.browser.init(doc.app, .{}, null) catch |err| {
        setError("bl_parse_html: Browser.init: {s}", .{@errorName(err)});
        return null;
    };
    var cleanup_browser_init = true;
    defer if (cleanup_browser_init) doc.browser.deinit();

    // Browser.parseStatic is added by the patch.
    // It calls Session.createPage() + Frame.parseHtmlDocument() and returns
    // the root Frame without executing scripts.
    doc.frame = doc.browser.parseStatic(html_slice) catch |err| {
        setError("bl_parse_html: parseStatic: {s}", .{@errorName(err)});
        return null;
    };

    // Success — cancel all cleanup defers.
    cleanup_doc = false;
    cleanup_app = false;
    cleanup_browser_alloc = false;
    cleanup_browser_init = false;

    return @ptrCast(doc);
}

/// Destroy a document and free all DOM nodes.
/// After this call any *BlElement derived from this document is invalid.
export fn bl_document_destroy(d: *BlDocument) void {
    clearError();
    const alloc = gpa.allocator();
    const doc: *DocumentImpl = @ptrCast(@alignCast(d));
    doc.browser.deinit();
    doc.app.deinit();
    alloc.destroy(doc);
}

// ---------------------------------------------------------------------------
// C ABI — selector queries
// ---------------------------------------------------------------------------

/// Return the first element matching a CSS selector, or null if none matches.
/// On error null is returned and bl_last_error() is non-empty.
/// The caller must free the result with bl_element_free().
///
///   d            — document handle
///   selector     — CSS selector bytes
///   selector_len — byte length of selector
export fn bl_query_selector(
    d: *BlDocument,
    selector: [*]const u8,
    selector_len: usize,
) ?*BlElement {
    clearError();
    const doc: *DocumentImpl = @ptrCast(@alignCast(d));
    const sel_slice = selector[0..selector_len];

    const root = doc.frame.document.asNode();

    const maybe_el = Selector.querySelector(root, sel_slice, doc.frame) catch |err| {
        setError("bl_query_selector: {s}", .{@errorName(err)});
        return null;
    };
    // Selector.querySelector returns ?*DomNode.Element which is the same type
    // as *DomElement (Node.zig defines `pub const Element = @import("Element.zig")`).
    const el: *DomElement = maybe_el orelse return null;

    const alloc = gpa.allocator();
    const wrapper = alloc.create(ElementImpl) catch {
        setError("bl_query_selector: OOM", .{});
        return null;
    };
    wrapper.* = .{ .element = el, .doc = doc };
    return @ptrCast(wrapper);
}

/// Return all elements matching a CSS selector.
/// *out_count is set to the match count.  On error returns null (out_count 0).
/// Free the result with bl_array_free(arr, count).
///
///   d            — document handle
///   selector     — CSS selector bytes
///   selector_len — byte length of selector
///   out_count    — written with the number of matching elements
export fn bl_query_selector_all(
    d: *BlDocument,
    selector: [*]const u8,
    selector_len: usize,
    out_count: *usize,
) ?[*]?*BlElement {
    clearError();
    out_count.* = 0;

    const doc: *DocumentImpl = @ptrCast(@alignCast(d));
    const sel_slice = selector[0..selector_len];
    const alloc = gpa.allocator();

    const root = doc.frame.document.asNode();

    // querySelectorAll returns a List backed by a frame arena.
    // We materialise the results into GPA-owned wrappers before releasing
    // the arena, so the caller can hold references across calls.
    const list = Selector.querySelectorAll(root, sel_slice, doc.frame) catch |err| {
        setError("bl_query_selector_all: {s}", .{@errorName(err)});
        return null;
    };
    // List.deinit releases the arena slice from the frame's arena pool.
    // We access the Page via doc.frame._page.
    defer list.deinit(doc.frame._page);

    // List._nodes is a []const *DomNode.  Each node in querySelectorAll results
    // is guaranteed to be an element (only elements match CSS selectors).
    // We access the raw slice directly, then cast each *DomNode to *DomElement
    // via DomNode.as(DomElement).
    const nodes: []const *DomNode = list._nodes;
    const count = nodes.len;

    const arr = alloc.alloc(?*BlElement, count) catch {
        setError("bl_query_selector_all: OOM for result array", .{});
        return null;
    };

    for (nodes, 0..) |node, idx| {
        // All nodes returned by querySelectorAll are elements — CSS selectors
        // can only match element nodes.  Access via the node's tagged union.
        // node._type.element is *Element (webapi/Element.zig).
        const el_ptr: *DomElement = node._type.element;
        const wrapper = alloc.create(ElementImpl) catch {
            for (arr[0..idx]) |maybe| {
                if (maybe) |ep|
                    alloc.destroy(@as(*ElementImpl, @ptrCast(@alignCast(ep))));
            }
            alloc.free(arr);
            setError("bl_query_selector_all: OOM for ElementImpl", .{});
            return null;
        };
        wrapper.* = .{ .element = el_ptr, .doc = doc };
        arr[idx] = @ptrCast(wrapper);
    }

    out_count.* = count;
    return arr.ptr;
}

// ---------------------------------------------------------------------------
// C ABI — element accessors
// ---------------------------------------------------------------------------

/// Return the concatenated text content of all descendant text nodes.
/// Free with bl_string_free().
export fn bl_element_text_content(e: *BlElement) BlString {
    clearError();
    const wrapper: *ElementImpl = @ptrCast(@alignCast(e));
    const alloc = gpa.allocator();

    // getTextContentAlloc returns [:0]const u8 allocated on `alloc`.
    // Element.asNode() returns *DomNode.
    const text: [:0]const u8 = wrapper.element.asNode().getTextContentAlloc(alloc) catch |err| {
        setError("bl_element_text_content: {s}", .{@errorName(err)});
        return blStringErr();
    };
    // The slice already has a null terminator at text.ptr[text.len].
    return .{ .data = text.ptr, .len = text.len, .capacity = text.len + 1 };
}

/// Return the innerHTML (children serialized as HTML).
/// Free with bl_string_free().
export fn bl_element_inner_html(e: *BlElement) BlString {
    clearError();
    const wrapper: *ElementImpl = @ptrCast(@alignCast(e));
    const alloc = gpa.allocator();

    // getInnerHTML writes to a growing buffer allocated on `alloc`.
    // We use the GPA (not frame.call_arena) so the result outlives the call.
    var buf = std.Io.Writer.Allocating.init(alloc);
    wrapper.element.getInnerHTML(&buf.writer, wrapper.doc.frame) catch |err| {
        setError("bl_element_inner_html: {s}", .{@errorName(err)});
        return blStringErr();
    };
    return blStringAlloc(alloc, buf.written()) catch {
        setError("bl_element_inner_html: OOM", .{});
        return blStringErr();
    };
}

/// Return the outerHTML (element + children serialized as HTML).
/// Free with bl_string_free().
export fn bl_element_outer_html(e: *BlElement) BlString {
    clearError();
    const wrapper: *ElementImpl = @ptrCast(@alignCast(e));
    const alloc = gpa.allocator();

    var buf = std.Io.Writer.Allocating.init(alloc);
    wrapper.element.getOuterHTML(&buf.writer, wrapper.doc.frame) catch |err| {
        setError("bl_element_outer_html: {s}", .{@errorName(err)});
        return blStringErr();
    };
    return blStringAlloc(alloc, buf.written()) catch {
        setError("bl_element_outer_html: OOM", .{});
        return blStringErr();
    };
}

/// Return the value of a named attribute, or an empty BlString if absent.
/// Free with bl_string_free().
///
///   name      — attribute name bytes
///   name_len  — byte length of the name
export fn bl_element_get_attribute(
    e: *BlElement,
    name: [*]const u8,
    name_len: usize,
) BlString {
    clearError();
    const wrapper: *ElementImpl = @ptrCast(@alignCast(e));
    const alloc = gpa.allocator();

    // getAttributeSafe reads from the element's attribute list without
    // needing a Frame — no V8 interaction.
    // lp.String is src/string.zig's String type.
    const lp_name = lp.String.wrap(name[0..name_len]);
    const value: ?[]const u8 = wrapper.element.getAttributeSafe(lp_name);

    return blStringAlloc(alloc, value orelse "") catch {
        setError("bl_element_get_attribute: OOM", .{});
        return blStringErr();
    };
}

/// Return the tag name in canonical HTML case ("DIV", "A", "SPAN", …).
/// Free with bl_string_free().
export fn bl_element_tag_name(e: *BlElement) BlString {
    clearError();
    const wrapper: *ElementImpl = @ptrCast(@alignCast(e));
    const alloc = gpa.allocator();

    var stack_buf: [256]u8 = undefined;
    const tag = wrapper.element.getTagNameSpec(&stack_buf);

    return blStringAlloc(alloc, tag) catch {
        setError("bl_element_tag_name: OOM", .{});
        return blStringErr();
    };
}

// ---------------------------------------------------------------------------
// C ABI — memory management
// ---------------------------------------------------------------------------

/// Free a BlString returned by any bl_element_* function.
/// After this call the BlString is invalid.
export fn bl_string_free(s: BlString) void {
    if (s.capacity == 0) return; // sentinel — nothing to free
    const alloc = gpa.allocator();
    alloc.free(@constCast(s.data[0..s.capacity]));
}

/// Free an element wrapper returned by bl_query_selector().
/// Does NOT free the underlying DOM node (owned by the document arena).
export fn bl_element_free(e: *BlElement) void {
    const alloc = gpa.allocator();
    alloc.destroy(@as(*ElementImpl, @ptrCast(@alignCast(e))));
}

/// Free the array + element wrappers from bl_query_selector_all().
/// Does NOT free the underlying DOM nodes.
export fn bl_array_free(arr: [*]?*BlElement, count: usize) void {
    const alloc = gpa.allocator();
    for (arr[0..count]) |maybe| {
        if (maybe) |ep|
            alloc.destroy(@as(*ElementImpl, @ptrCast(@alignCast(ep))));
    }
    alloc.free(arr[0..count]);
}

// ---------------------------------------------------------------------------
// C ABI — error reporting
// ---------------------------------------------------------------------------

/// Return a null-terminated string describing the last error in this thread.
/// Valid until the next bl_* call from the same thread.
/// Returns "" if no error has occurred.  Do NOT free.
export fn bl_last_error() [*:0]const u8 {
    if (tl_error_len == 0) return "";
    return tl_error_buf[0..tl_error_len :0];
}
