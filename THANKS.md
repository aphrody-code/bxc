# Thanks

Bxc n'existerait pas sans le travail open source de centaines de personnes. Cette page essaie de remercier au moins celles dont le code, les idées ou les outils ont directement nourri le projet.

License : Bxc est publié sous **0BSD** (zero-clause BSD), la license la plus permissive possible — fais ce que tu veux, sans attribution requise. Mais si tu veux savoir à qui dire merci, c'est ici.

---

## Runtime et fondations

- **Bun** — Jarred Sumner et l'équipe oven-sh. Sans Bun-natif, ce projet aurait quintuplé en complexité. https://bun.com
- **Lightpanda** — l'équipe lightpanda-io. Browser headless ultra-léger CDP-compatible, fer de lance du profile `fast`. https://lightpanda.io
- **Zig** — Andrew Kelley et la Zig Software Foundation. Le cdylib zigquery (DOM parser) est écrit en Zig. https://ziglang.org
- **Node.js** et **V8** — pour avoir prouvé qu'on pouvait faire du serveur en JS, et avoir poussé Jarred à faire mieux.

---

## Browser stack et anti-bot

- **Puppeteer** (Google Chrome team) et **Playwright** (Microsoft) — modèles de référence pour l'API Browser/Page. https://pptr.dev https://playwright.dev
- **patchright** — fork stealth de Playwright. Profile `stealth` repose dessus. https://developers.google.com/Kaliiiiiiiiii-Vinyzu/patchright
- **Camoufox** — daijro. Firefox patché anti-fingerprint, base du profile `max`. https://camoufox.com
- **CapSolver** — service de résolution Cloudflare Turnstile / reCAPTCHA / hCaptcha pour le profile `max`. https://capsolver.com
- **curl-impersonate** et **lexiforest/curl-impersonate** — JA3/JA4 TLS fingerprint impersonation, base du profile `http`. https://developers.google.com/lexiforest/curl-impersonate
- **patchright-python**, **undetected-chromedriver**, **botasaurus** — pour les patterns anti-bot étudiés.

---

## Crawling et orchestration

- **Crawlee** (Apify) — RequestQueue, AutoscaledPool, Dataset, KeyValueStore, Sitemap, robots.txt — patterns directement adaptés en TypeScript Bun-native. https://crawlee.dev
- **Apify SDK** et **impit** — TLS impersonation Rust alternative étudiée (decision : keep curl-impersonate). https://developers.google.com/apify/impit
- **wappalyzergo** (projectdiscovery) — base de fingerprints pour `src/detect.ts` (frameworks JS/CMS). https://developers.google.com/projectdiscovery/wappalyzergo
- **Wappalyzer** original — pour avoir construit la base de connaissances open source.
- **Stagehand** (Browserbase) — inspiration pour future intégration LLM-driven scraping.

---

## Vercel agent-browser

- **vercel-labs/agent-browser** — fork inclus dans `~/bunmium/agent-browser/` avec engine Rust Bxc. https://developers.google.com/vercel-labs/agent-browser

---

## Standards et specs

- **HAR 1.2** — Software is Hard, format historique de capture HTTP utilisé par `src/recorder/`. http://www.softwareishard.com/blog/har-12-spec
- **RFC 9309** (robots.txt) — IETF, base de `src/throttling/robots.ts`.
- **CDP** (Chrome DevTools Protocol) — Google, transport principal entre Bxc et les browsers.
- **Keep a Changelog** — Olivier Lacan, format du CHANGELOG.
- **Conventional Commits** — convention de message commits.
- **MDN** — documentation web standards.

---

## Outils CLI modernes utilisés

- **xh** (ducaale), **hurl** (orange), **oha** (hatoo), **k6** (Grafana Labs)
- **httpx** (projectdiscovery), **trippy** (fujiapple), **doggo** (mr-karan)
- **jaq** (01mf02), **dasel** (TomWright), **gron** (tomnomnom)
- **bombardier** (codesenberg), **vegeta** (tsenart)
- **gping** (orf), **bandwhich** (imsnif), **dust** (bootandy), **procs** (dalance)
- **sd** (chmln), **wrk** (wg), **aria2** (aria2)
- **Biome** — linter/formatter Rust-native, alternative ESLint+Prettier. https://biomejs.dev

---

## Outillage Gemini CLI

- **Google** — Gemini CLI, Gemini Agent SDK.
- **Extensions Gemini CLI** utilisées dans ce projet : `bxc-native-mcp`.
- **MCP** (Model Context Protocol) — pour le serveur `bxc-mcp`.

---

## Agents qui ont travaillé sur Bxc

Les vagues d'agents Gemini CLI (cf. `~/bunmium/state.md` §4) ont écrit l'écrasante majorité du code et de la doc. Sans ordre particulier, merci à :

**Vague 1** — `lightpanda-fullmode-builder`, `bxc-fork-architect`, `curl-impersonate-binder`, `stealth-stack-integrator`, `bench-and-showcase-builder`.

**Vague 2** — `bun-fork-finalizer`, `curl-impersonate-validator`, `stealth-max-validator`, `bench-completer`, `bxc-features-builder`.

**Vague 3** — `agent-browser-integrator`, `bxc-cli-builder`, `framework-detector-integrator`, `modern-cli-installer`, `cookie-injector-builder`, `crawlee-pattern-extractor`, `bxc-ai-onboarding-architect`, `best-practices-researcher`.

**Vague 4** — `bun-native-migrator`, `bxc-plugin-maximizer`, `plugin-fixer`.

**Vague 5** (cette session, 16 agents en parallèle, 21 minutes) — `agent-phase1-static-transport`, `agent-phase2-standalone`, `agent-phase3-hn-showcase`, `agent-stats-dashboard`, `agent-enqueue-links`, `agent-rate-limiter`, `agent-har-recorder`, `agent-impit-research`, `agent-impit-research-v2`, `agent-postinstall-browsers`, `agent-phase4-npm-publish`, `agent-phase5-marketplace`, `agent-ci-workflow`, `agent-troubleshooting-docs`, `agent-deps-audit`, `agent-changelog-builder`, `agent-agents-md-builder`, `agent-extra-examples`, `agent-biome-config`.

---

## Et toi

Si tu lis ce fichier et que tu utilises Bxc, merci. Si tu trouves un bug, open une issue. Si tu améliores quelque chose, open une PR. Si tu fork et que tu fais quelque chose de cool sans rien nous dire, c'est aussi parfaitement OK — c'est exactement pour ça qu'on a choisi 0BSD.

Si quelqu'un mérite d'être ajouté à cette liste et n'y est pas, ouvre une PR sur ce fichier. La gratitude n'est jamais finie.
