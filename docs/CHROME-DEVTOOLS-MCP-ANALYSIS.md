# Chrome DevTools MCP Analysis Report

Analysis of `ChromeDevTools/chrome-devtools-mcp` v0.26.0 for Bunlight MCP optimization.

## Architecture Overview

```
chrome-devtools-mcp/
  src/
    index.ts              -- Server factory (createMcpServer)
    ToolHandler.ts        -- Centralized handler with Mutex, telemetry, error normalization
    McpResponse.ts        -- Response builder (1188 LOC!) with structured content
    McpContext.ts          -- Page management, devtools bridge
    Mutex.ts              -- FIFO tool serialization
    tools/
      ToolDefinition.ts   -- defineTool() / definePageTool() factories
      categories.ts       -- 10 tool categories (input, navigation, debugging, network, etc)
      tools.ts            -- Registry: creates + sorts all tools
      pages.ts            -- list_pages, select_page, new_page, navigate_page, handle_dialog
      screenshot.ts       -- take_screenshot (PNG/JPEG/WebP, element or fullPage)
      snapshot.ts          -- take_snapshot (a11y tree), wait_for
      network.ts          -- list_network_requests, get_network_request
      script.ts           -- evaluate_script (JS execution in page/frame/worker)
      console.ts          -- list_console_messages, get_console_message
      emulation.ts        -- emulate_settings, clear_emulation
      input.ts            -- click, type, drag, hover, scroll, keyboard
      performance.ts      -- start/stop performance traces, CrUX
      memory.ts           -- take_heap_snapshot, list_heap_snapshot
      lighthouse.ts       -- run_lighthouse
      screencast.ts       -- start/stop screen recording
      extensions.ts       -- install/uninstall/list extensions
      slim/tools.ts       -- Minimal "slim" mode (4 essential tools)
```

## Key Patterns Worth Adopting

### 1. Tool Serialization via Mutex
Every tool call goes through a single `Mutex.acquire()`. This prevents concurrent CDP calls from colliding. Our Bunlight MCP currently has NO serialization -- a parallel `pool_run` could conflict with a `scrape`.

### 2. Tool Categories
Tools are organized into categories (`input`, `navigation`, `debugging`, `network`, `performance`, `memory`, `emulation`, `extensions`). This enables:
- Conditional registration (categories can be disabled via flags)
- Better tooling for LLM agents (category hints in annotations)

### 3. `defineTool()` / `definePageTool()` Factories
Clean separation between page-scoped tools (need a page context) and global tools. This maps to Bunlight's distinction between page operations and Browser-level operations.

### 4. Response Builder Pattern
The `McpResponse` class (1188 LOC) accumulates response parts (text lines, images, snapshots, network data) and formats them at the end. This is superior to our approach of building JSON strings inline.

### 5. Structured Content
Every response includes both `content` (text/image) and `structuredContent` (typed JSON). This gives clients machine-readable data alongside human-readable text.

### 6. `wait_for` Tool
A `wait_for` tool that waits for text to appear on a page. Essential for SPAs. We should add this.

### 7. File Output Options
Screenshot and snapshot tools support `filePath` to save to disk instead of returning inline. For large data (>=2MB screenshots), auto-saves to temp file.

### 8. Dialog Handling
Script execution tools handle dialogs (alert, confirm, prompt) via `handleDialog` option. Prevents tool from hanging.

### 9. Tool Annotations with Categories
```typescript
annotations: {
  title: 'Screenshot',
  category: ToolCategory.DEBUGGING,
  readOnlyHint: false,      // false because it can save files
  conditions: ['flag'],     // conditional registration
}
```

### 10. Slim Mode
A minimal "slim" mode with only 4 essential tools for bandwidth-constrained environments.

## Improvements to Apply to Bunlight MCP

Based on this analysis, the following improvements are highest-value:

### P0: Tool Serialization (Mutex)
Add a FIFO mutex to prevent concurrent tool calls from colliding on the Browser singleton.

### P0: Response Builder
Replace inline `JSON.stringify` with a proper response builder that accumulates text + images + structured data.

### P1: `wait_for` Tool
Add `bunlight_wait_for` that polls for text/selector on a page. Critical for SPA scraping.

### P1: `evaluate_script` Tool
Add `bunlight_evaluate` for JS execution in page context. Already supported by Bunlight's `page.evaluate()`.

### P1: Structured Content
Add `structuredContent` to every tool response alongside `content`.

### P2: Tool Categories
Organize tools into categories: `scraping`, `detection`, `extraction`, `navigation`, `media`.

### P2: Large Response Handling
For screenshots > 2MB, auto-save to temp file instead of base64 inline.

### P3: Slim Mode
A `slim` flag that only registers `bunlight_scrape`, `bunlight_detect`, `bunlight_dom_query`.
