> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Inspect memory usage using V8 heap snapshots

Bun implements V8's heap snapshot API, which allows you to create snapshots of the heap at runtime. This helps debug memory leaks in your JavaScript/TypeScript application.

```ts snapshot.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
import v8 from "node:v8";

// Creates a heap snapshot file with an auto-generated name
const snapshotPath = v8.writeHeapSnapshot();
console.log(`Heap snapshot written to: ${snapshotPath}`);
```

***

## Inspect memory in Chrome DevTools

To view V8 heap snapshots in Chrome DevTools:

1. Open Chrome DevTools (F12 or right-click and select "Inspect")
2. Go to the "Memory" tab
3. Click the "Load" button (folder icon)
4. Select your `.heapsnapshot` file

<Frame>
  <img src="https://mintcdn.com/bun-1dd33a4e/o4ey1PfJcT885lrd/images/chrome-devtools-memory.png?fit=max&auto=format&n=o4ey1PfJcT885lrd&q=85&s=8f11aeea8ad1f70974bb963f83c4decf" alt="Chrome DevTools Memory Tab" width="1770" height="1201" data-path="images/chrome-devtools-memory.png" />
</Frame>
