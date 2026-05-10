---
description: Benchmark a URL across all Bunlight profiles
argument-hint: [url] [iterations]
allowed-tools: ["Read", "Write", "Edit", "Bash"]
---

Benchmark `$1` across all 5 Bunlight profiles for `$2` iterations (default 20).

Steps:

1. Validate `$1` is a URL.
2. Default `$2` to `20`. Refuse iterations > 200 to prevent runaway runs.
3. Delegate to the `bunlight-bench-runner` agent to:
   - Write a one-off scenario at `benchmarks/scenarios/url-sweep-<slug>.ts` if it does not exist.
   - Run the scenario for each profile in `[static, fast, http, stealth, max]`.
   - Capture median, p50, p95, p99 latency and peak RSS.
4. Save raw JSON to `benchmarks/results/<slug>-<ISO-date>.json`.
5. Report a markdown table with one row per profile and a one-paragraph interpretation.

Refuse to run against a private or rate-limited target without explicit user confirmation. Always cap iterations at 200.
