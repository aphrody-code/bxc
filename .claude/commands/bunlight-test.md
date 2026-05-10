---
description: Run Bunlight tests, optionally filtered by profile or scope
argument-hint: [scope] [profile]
allowed-tools: ["Read", "Edit", "Bash"]
---

Run Bunlight tests via `bun test`, where `$1` is the scope (`unit`, `integration`, `all`, or a file path) and `$2` is an optional profile filter.

Steps:

1. Default `$1` to `all` and `$2` to empty if not provided.
2. Resolve the scope:
   - `unit`        -> `bun test test/unit/`
   - `integration` -> `bun test test/integration/`
   - `all`         -> `bun test`
   - file path     -> `bun test $1`
3. If `$2` is provided and non-empty, append `--testNamePattern="profile=$2"`.
4. Delegate to the `bunlight-test-runner` agent to:
   - Run the resolved command.
   - Parse output: pass/fail/skip counts.
   - Show the first 3 failing assertions verbatim with file:line.
5. If failures exist, propose a fix (test or implementation) without applying it. Ask the user to confirm before patching.
6. After a fix is confirmed, re-run the same scope to verify green.

Report: command run, summary counts, first failure (if any), and the next-step recommendation.
