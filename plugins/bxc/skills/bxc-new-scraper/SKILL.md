---
name: bxc-new-scraper
description: Create a new bxc scraper package under packages/ with its exports, CLI integration, tests and documentation.
metadata:
  short-description: Add a bxc scraper package.
---

Follow an existing package under `packages/` as the template. Keep the package
name and published name aligned as `@aphrody/<kebab-name>`, add the CLI entry
under `src/cli/` when needed, and expose a typed public API from the package.

Add offline tests for parsing and error handling. Use the appropriate bxc
transport profile (`static`, `http`, `fast`, `stealth`, or `max`) and do not add
live network tests to the default verification path. Run the narrow package
typecheck/tests plus the bxc scoped verification before handing off.
