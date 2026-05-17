# AGENTS.md — Bunlight v0.1.0 (Stable)

Instructions for AI agents (Gemini CLI, etc.) working on the Bunlight monorepo.

---

## 🏗 Repository Context

Bunlight is a high-performance browser automation engine merging **Bun** and **Lightpanda**.  
It operates as a **Monorepo** managed by **Turborepo**.

### Core Stack
- **Runtime**: Bun >= 1.3.0
- **Build System**: Turborepo
- **Linting**: Biome
- **Tests**: `bun:test`
- **MCP SDK**: Vendored Bun-native SDK (`vendor/mcp-sdk-typescript`)

---

## 🛠 Command Reference

Always use the root-level scripts for consistency:

| Command | Description |
|---------|-------------|
| `bun run build` | Build all packages and FFI extensions via Turbo |
| `bun run test` | Run all tests via Turbo |
| `bun run lint` | Check linting and formatting |
| `bun run typecheck` | Run TypeScript compiler in `noEmit` mode |
| `bun run clean` | Deep clean logs, caches, and temp files |

---

## 📂 Structure

- `/src`: Core library source.
- `/bin`: CLI entrypoints.
- `/extensions`: Extensions and MCP servers.
- `/vendor`: Native binaries, C/Zig sources, and the **vendored MCP SDK**.
- `/scripts`: Build, install, and maintenance scripts.

---

## 🤖 AI Guidelines

1. **Autonomous Mode**: Opérer en autonomie maximale. Pas de demande de confirmation
   sauf pour : `git push --force` sur main, bypass de hooks, drop de données réelles,
   leak de secrets. Tout le reste : décider et exécuter.
2. **Profile Choice**: When writing scrapers, start with `static` (fastest) and escalate to `stealth` only if blocked.
3. **Lazy Loading**: Use lazy imports for `bunlight` core in extensions to ensure compatibility across environments.
4. **Serialization**: Use the built-in `Mutex` when implementing tools that interact with the Browser singleton.
5. **No Placeholders**: Generate real code and assets. Use `generate_image` for UI mocks.

---

## 🚀 Release Process

1. Clean the repo: `bun run clean`
2. Build everything: `bun run build`
3. Run tests: `bun run test`
4. Bump version: `npm version <patch|minor|major>`
5. Push with tags: `git push origin main --tags`
