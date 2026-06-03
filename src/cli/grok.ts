/**
 * Copyright 2026 aphrody-code
 * `bxc grok` — native xAI API client (no XAI_API_KEY when ~/.grok/auth.json exists).
 */

import { XaiClient } from "@aphrody-code/xai";
import { EXIT, type CommonOptions, logger } from "./shared.ts";

type Action = "whoami" | "models" | "chat" | "tts" | "stt" | "raw";

interface GrokCliOptions extends CommonOptions {
  action: Action;
  positional: string[];
  model: string;
  maxTokens: number;
  stream: boolean;
  bearer?: string;
  output?: string;
  temperature?: number;
}

function printUsage(): void {
  Bun.stdout.write(
    `bxc grok — xAI Grok API (OpenAI-compatible, keyless via Grok CLI session)

Usage:
  bxc grok whoami                         Auth source (OIDC vs API key)
  bxc grok models [--json]                GET /v1/models
  bxc grok chat <prompt>                  POST /v1/chat/completions
  bxc grok tts <text> [--output file]   POST /v1/tts (default model eve)
  bxc grok stt <audio-file>             POST /v1/stt
  bxc grok raw <METHOD> <path> [json]    Generic API call (path under /v1)

Options:
  --model <id>        Model id (default grok-3-mini for chat)
  --max-tokens <N>    Max completion tokens (default 1024)
  --temperature <T>   Sampling temperature
  --stream            SSE stream for chat
  --bearer <token>    Override bearer (else XAI_API_KEY or ~/.grok/auth.json)
  --output <path>     Write binary TTS output to file
  --json              JSON stdout (default for most actions)
  --help, -h

Auth (no developer API key required):
  1. Grok Build OIDC JWT in ~/.grok/auth.json (run: grok login)
  2. Or metered XAI_API_KEY in environment

Examples:
  bxc grok whoami
  bxc grok models
  bxc grok chat "Explain zero-spawn browsers in one sentence"
  bxc grok chat "Hi" --model grok-4 --stream
  bxc grok tts "Hello world" --output /tmp/hello.mp3

`,
  );
}

function parseArgs(
  argv: readonly string[],
  baseOpts: CommonOptions,
): GrokCliOptions | null {
  const valid: Action[] = ["whoami", "models", "chat", "tts", "stt", "raw"];
  const actionStr = argv[0];
  if (!valid.includes(actionStr as Action)) return null;

  const opts: GrokCliOptions = {
    ...baseOpts,
    action: actionStr as Action,
    positional: [],
    model: "grok-3-mini",
    maxTokens: 1024,
    stream: false,
  };

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--model":
        opts.model = argv[++i] ?? opts.model;
        break;
      case "--max-tokens":
        opts.maxTokens = parseInt(argv[++i], 10) || opts.maxTokens;
        break;
      case "--temperature":
        opts.temperature = parseFloat(argv[++i]);
        break;
      case "--stream":
        opts.stream = true;
        break;
      case "--bearer":
        opts.bearer = argv[++i];
        break;
      case "--output":
      case "-o":
        opts.output = argv[++i];
        break;
      case "--help":
      case "-h":
        return null;
      default:
        if (!a.startsWith("-")) opts.positional.push(a);
    }
  }
  return opts;
}

function emit(data: unknown, json: boolean): void {
  if (json) {
    Bun.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else if (typeof data === "string") {
    Bun.stdout.write(`${data}\n`);
  } else {
    Bun.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  }
}

async function drainSse(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    Bun.stdout.write(dec.decode(value, { stream: true }));
  }
}

export async function main(
  argv: readonly string[],
  baseOpts: CommonOptions,
): Promise<void> {
  const opts = parseArgs(argv, baseOpts);
  if (!opts) {
    printUsage();
    process.exit(EXIT.MISUSE);
  }

  let client: XaiClient;
  try {
    client = new XaiClient({ bearer: opts.bearer });
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(EXIT.MISUSE);
  }

  try {
    switch (opts.action) {
      case "whoami":
        emit(client.whoami(), true);
        break;

      case "models":
        emit(await client.listModels(), opts.json);
        break;

      case "chat": {
        const prompt = opts.positional.join(" ").trim();
        if (!prompt) {
          logger.error("chat requires a prompt");
          process.exit(EXIT.MISUSE);
        }
        const result = await client.chat({
          model: opts.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: opts.maxTokens,
          temperature: opts.temperature,
          stream: opts.stream,
        });
        if (opts.stream && result instanceof ReadableStream) {
          await drainSse(result);
        } else {
          const res = result as { choices: { message: { content: string } }[] };
          emit(
            opts.json
              ? res
              : (res.choices[0]?.message?.content ?? ""),
            opts.json,
          );
        }
        break;
      }

      case "tts": {
        const text = opts.positional.join(" ").trim();
        if (!text) {
          logger.error("tts requires text");
          process.exit(EXIT.MISUSE);
        }
        const buf = await client.tts({ input: text, model: opts.model });
        if (opts.output) {
          await Bun.write(opts.output, buf);
          emit({ ok: true, path: opts.output, bytes: buf.byteLength }, true);
        } else {
          await Bun.write("/dev/stdout", buf);
        }
        break;
      }

      case "stt": {
        const path = opts.positional[0];
        if (!path) {
          logger.error("stt requires <audio-file>");
          process.exit(EXIT.MISUSE);
        }
        const file = Bun.file(path);
        if (!(await file.exists())) {
          logger.error(`file not found: ${path}`);
          process.exit(EXIT.MISUSE);
        }
        emit(await client.stt(file, { model: opts.model }), opts.json);
        break;
      }

      case "raw": {
        const method = (opts.positional[0] ?? "GET").toUpperCase() as
          | "GET"
          | "POST"
          | "DELETE";
        const path = opts.positional[1] ?? "/models";
        const bodyStr = opts.positional.slice(2).join(" ").trim();
        const body = bodyStr ? JSON.parse(bodyStr) : undefined;
        emit(await client.raw(method, path, body), opts.json);
        break;
      }
    }
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(EXIT.DATA_ERR);
  }
}