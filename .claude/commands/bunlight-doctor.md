---
description: Diagnose the Bunlight installation (binaries, FFI cdylibs, profiles)
allowed-tools: ["Read", "Bash"]
---

Run a full installation check for Bunlight in the current project. Emit a report with one line per dependency.

Steps:

1. Bun runtime:
   - Run `bun --version`. Require >= 1.3.0.
2. Bunlight package:
   - Check `node_modules/@bunmium/bunlight/package.json` exists and parses.
   - Report the installed version.
3. TypeScript:
   - Check `tsc --version`.
4. Lightpanda binary (used by `fast` profile):
   - Check `$LIGHTPANDA_BIN`, then `command -v lightpanda`. Report path and `lightpanda --version`.
   - If missing, print install instructions.
5. curl-impersonate (used by `http` profile):
   - Check `command -v curl-impersonate-chrome` or the FFI cdylib in `vendor/curl-impersonate/`.
6. Camoufox (used by `max` profile):
   - Check `vendor/camoufox/` exists.
7. patchright (used by `stealth` profile):
   - Check `node_modules/patchright/package.json`.
8. wappalyzergo (used by `bunlight_detect`):
   - Check `vendor/wappalyzergo/wappalyzergo` is executable.
9. CapSolver key:
   - Read `.claude/bunlight.local.md` if present, surface presence/absence (never print the value).
10. Cookie jars:
    - List `cookies/private/*.json` count (do not print contents).

Output a tabular report:

```
| Dependency        | Status | Notes                           |
|-------------------|--------|---------------------------------|
| Bun runtime       | OK     | v1.3.2                          |
| @bunmium/bunlight | OK     | v0.1.0-alpha installed          |
| Lightpanda        | MISSING| install via scripts/build-...   |
| ...               | ...    | ...                             |
```

End with a line listing which profiles are currently available given the install state, e.g. "Available: static, fast. Missing: http (needs curl-impersonate), stealth (needs patchright), max (needs camoufox + capsolver)."
