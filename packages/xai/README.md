# @aphrody-code/xai

Headless **xAI Grok** client for Bun — OpenAI-compatible `https://api.x.ai/v1`.

## Auth (no `XAI_API_KEY` required)

After `grok login`, Grok Build stores an OIDC JWT in `~/.grok/auth.json`. This package uses that token as `Authorization: Bearer …` (same as the Grok CLI).

Resolution order:

1. Explicit `bearer` option / `--bearer`
2. `XAI_API_KEY` environment variable (metered `xai-…` key)
3. `~/.grok/auth.json` → `key` field (OIDC)

## CLI (`bxc grok`)

```bash
bxc grok whoami
bxc grok models
bxc grok chat "Hello"
bxc grok chat "Hi" --model grok-4 --stream
bxc grok tts "Hello" --output /tmp/out.mp3
bxc grok stt recording.wav
bxc grok raw GET /models
```

## Library

```ts
import { XaiClient } from "@aphrody-code/xai";

const client = new XaiClient();
const models = await client.listModels();
const reply = await client.complete("Explain Rust in one line", "grok-3-mini");
```

## MCP

- `bxc_grok_whoami`
- `bxc_grok_models`
- `bxc_grok_chat`