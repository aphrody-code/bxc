> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Install a package under a different name

To install an npm package under an alias:

```sh terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
bun add my-custom-name@npm:zod
```

***

The `zod` package can now be imported as `my-custom-name`.

```ts index.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
import { z } from "my-custom-name";

z.string();
```

***

See [Docs > Package manager](/pm/cli/install) for complete documentation of Bun's package manager.
