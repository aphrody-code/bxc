---
name: bxc Scraper Monorepo
description: This skill should be used when creating or maintaining scraper packages under packages/ (fut, voiranime, xcom, zukan, worldbeyblade, challonge, etc.), following the monorepo workspace pattern, CLI integration in src/cli/, profile mapping (stealth/http/static...), and publishing as @aphrody/*.
version: 0.1.0
---

See existing packages/ as templates. New subcommand in src/cli/index.ts + dedicated src/cli/<name>.ts exporting `main(argv, baseOpts)`.

Use the bxc-scraper-creator agent.

Cross-platform and no heavy deps preferred.
