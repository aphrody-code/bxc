---
description: Initialize a new Bunlight project with TypeScript setup, folder structure, and ready-to-run examples
argument-hint: <project-name>
allowed-tools: ["Read", "Write", "Edit", "Bash"]
---

# Initialize a new Bunlight project

The user invoked this with: `$ARGUMENTS`

Create a new Bun project at `./$1` (interpreted relative to the current working directory) with Bunlight pre-configured. Treat `$1` as the project directory name.

Steps:

1. Validate `$1` is a non-empty string of kebab-case characters. If empty, ask the user for a project name and stop.
2. Create the directory structure:
   - `./$1/`
   - `./$1/src/`
   - `./$1/examples/`
   - `./$1/data/`
   - `./$1/output/`
   - `./$1/cookies/private/`
3. Write `./$1/package.json` with:
   - `name`: `$1`
   - `type`: `module`
   - `scripts.start`: `bun examples/hello.ts`
   - `dependencies`: `@bunmium/bunlight`
   - `devDependencies`: `@types/bun`, `typescript`
4. Write `./$1/tsconfig.json` with strict mode enabled, ESNext target, NodeNext module, `"types": ["bun-types"]`.
5. Write `./$1/.gitignore` covering `node_modules/`, `cookies/private/`, `output/`, `*.log`, `data/*.db`.
6. Write `./$1/examples/hello.ts` — a minimal "open example.com and print the title" Bunlight script using profile `fast`.
7. Write `./$1/README.md` with a 5-line quick start: install, run example, link to `/bunlight:cookbook` for more recipes.
8. Run `cd ./$1 && bun install` and report any failure verbatim.
9. Print a final summary listing the files created and the next command to run: `cd ./$1 && bun examples/hello.ts`.

Use only Bun-native APIs (`Bun.write`, `Bun.$`). Never use Node stdlib. No emojis in any generated file.

If `./$1` already exists and is non-empty, refuse and ask the user to pick a different name or remove the directory first.
