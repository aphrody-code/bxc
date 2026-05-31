> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Hot reload an HTTP server

Bun supports the [`--hot`](/runtime/watch-mode#hot-mode) flag to run a file with hot reloading enabled. When any module or file changes, Bun re-runs the file.

```sh terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
bun --hot run index.ts
```

***

Bun detects when you are running an HTTP server with `Bun.serve()`. It reloads your fetch handler when source files change, *without* restarting the `bun` process. This makes hot reloads nearly instantaneous.

<Note>
  Note that this doesn't reload the page on your browser.
</Note>

```ts index.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("Hello world");
  },
});
```
