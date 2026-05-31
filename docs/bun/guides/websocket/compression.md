> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Enable compression for WebSocket messages

Per-message compression can be enabled with the `perMessageDeflate` parameter. When set, all messages will be compressed using the [permessage-deflate](https://tools.ietf.org/html/rfc7692) WebSocket extension.

```ts server.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
Bun.serve({
  // ...
  websocket: {
    // enable compression
    perMessageDeflate: true,
  },
});
```

***

To enable compression for individual messages, pass `true` as the second parameter to `ws.send()`.

```ts server.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
Bun.serve({
  // ...
  websocket: {
    async message(ws, message) {
      // send a compressed message
      ws.send(message, true);
    },
  },
});
```
