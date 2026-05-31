> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Re-map import paths

Bun reads the `paths` field in your `tsconfig.json` to re-write import paths. This is useful for aliasing package names or avoiding long relative paths.

```json tsconfig.json icon="file-json" theme={"theme":{"light":"github-light","dark":"dracula"}}
{
  "compilerOptions": {
    "paths": {
      "my-custom-name": ["zod"],
      "@components/*": ["./src/components/*"]
    }
  }
}
```

***

With the above `tsconfig.json`, the following imports will be re-written:

```ts tsconfig.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
import { z } from "my-custom-name"; // imports from "zod"
import { Button } from "@components/Button"; // imports from "./src/components/Button"
```

***

See [Docs > Runtime > TypeScript](/runtime/typescript) for more information on using TypeScript with Bun.
