> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Import a TOML file

Bun natively supports importing `.toml` files.

```toml data.toml icon="file-code" theme={"theme":{"light":"github-light","dark":"dracula"}}
name = "bun"
version = "1.0.0"

[author]
name = "John Dough"
email = "john@dough.com"
```

***

Import the file like any other source file.

```ts data.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
import data from "./data.toml";

data.name; // => "bun"
data.version; // => "1.0.0"
data.author.name; // => "John Dough"
```

***

See [Docs > Runtime > TypeScript](/runtime/typescript) for more information on using TypeScript with Bun.
