> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Check if the current file is the entrypoint

Bun provides a handful of module-specific utilities on the [`import.meta`](/runtime/module-resolution#import-meta) object. Use `import.meta.main` to check if the current file is the entrypoint of the current process.

```ts index.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
if (import.meta.main) {
  // this file is directly executed with `bun run`
} else {
  // this file is being imported by another file
}
```

***

See [Docs > API > import.meta](/runtime/module-resolution#import-meta) for complete documentation.
