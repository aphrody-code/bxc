> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Build an HTTP server using Hono and Bun

[Hono](https://github.com/honojs/hono) is a lightweight ultrafast web framework designed for the edge.

```ts server.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
import { Hono } from "hono";
const app = new Hono();

app.get("/", c => c.text("Hono!"));

export default app;
```

***

Use `create-hono` to get started with one of Hono's project templates. Select `bun` when prompted for a template.

```sh terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
bun create hono myapp
```

```txt theme={"theme":{"light":"github-light","dark":"dracula"}}
✔ Which template do you want to use? › bun
cloned honojs/starter#main to /path/to/myapp
✔ Copied project files
```

```sh terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
cd myapp
bun install
```

***

Then start the dev server and visit [localhost:3000](http://localhost:3000).

```sh terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
bun run dev
```

***

Refer to Hono's guide on [getting started with Bun](https://hono.dev/getting-started/bun) for more information.
