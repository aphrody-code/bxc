> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Listen for CTRL+C

The `ctrl+c` shortcut sends an *interrupt signal* to the running process. This signal can be intercepted by listening for the `SIGINT` event. If you want to close the process, you must explicitly call `process.exit()`.

```ts process.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
process.on("SIGINT", () => {
  console.log("Ctrl-C was pressed");
  process.exit();
});
```

***

See [Docs > API > Utils](/runtime/utils) for more useful utilities.
