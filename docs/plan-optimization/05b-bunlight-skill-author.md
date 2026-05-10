# 05b — Agent `bunlight-skill-author`

**Phase** : 3
**Subagent type** : `claude-code-guide`
**Durée estimée** : 1.5h

## Mission

(1) Créer un skill agent-browser dédié à bunlight qui apprend aux LLMs à choisir le bon profile.
(2) Implémenter `bunlight serve --auto-profile` qui escalade automatiquement static → fast → stealth → max sur signal d'échec.

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `~/bunmium/docs/agent-browser/skill-data/core/SKILL.md` (modèle de skill, frontmatter, sections)
3. `~/bunmium/docs/agent-browser/skill-data/agentcore/SKILL.md` (modèle court pour un provider/engine)
4. `bunlight/src/cli/serve.ts`
5. `bunlight/src/profiles/{static,fast,stealth,max}/`

## Scope strict

**Touche** :
- `bunlight/.claude/skill-data/bunlight/SKILL.md` (à créer)
- `bunlight/.claude/skill-data/bunlight/references/profiles.md` (à créer si profondeur nécessaire)
- `bunlight/src/profiles/auto-escalation.ts` (à créer)
- `bunlight/src/cli/serve.ts` (ajout du flag `--auto-profile`)
- `bunlight/test/integration/auto-escalation.test.ts` (à créer)

**NE TOUCHE PAS** : autres skill-data dossiers, code CDP domains.

## Tâche 1 — SKILL.md

`bunlight/.claude/skill-data/bunlight/SKILL.md` :

```markdown
---
name: bunlight
description: Use bunlight as the browser engine for agent-browser. Use when the user wants to use bunlight, optimize for cold start / memory, bypass Cloudflare/DataDome via stealth or max profile, fingerprint TLS via http profile, or auto-escalate profiles. Triggers include "use bunlight", "bunlight engine", "bypass cloudflare", "stealth scraping", "JA4 fingerprint", "auto-escalate profile", "fast headless".
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*), Bash(bunlight:*)
---

# bunlight engine for agent-browser

bunlight is a Bun-native browser automation toolkit with 5 execution profiles, available as an agent-browser engine via `--engine bunlight`. Each profile trades speed for anti-detection capability.

## Quick start

agent-browser --engine bunlight --profile static open https://news.ycombinator.com   # fastest, static HTML
agent-browser --engine bunlight --profile fast open https://react.dev                # JS-capable via Lightpanda
agent-browser --engine bunlight --profile stealth open https://challonge.com         # Cloudflare bypass
agent-browser --engine bunlight --profile max open https://nowsecure.nl              # max anti-detection
agent-browser --engine bunlight --profile http open https://tls.peet.ws              # TLS fingerprint
agent-browser --engine bunlight --auto-profile open https://target.example.com       # auto-escalate

## Profile selection guide

| Profile | When | Cold start | RSS | JS | Anti-bot |
|---|---|---|---|---|---|
| static | SSR pages, RSS, sitemaps, scraping HTML | <5 ms | 30 MB | no | no |
| fast | SPAs, React/Vue/Next.js, login flows | 80 ms | 50 MB | yes | weak |
| stealth | Cloudflare, DataDome, basic anti-bot | 1 s | n/a | yes | medium |
| max | Turnstile, advanced bot detection | 2 s | n/a | yes | strong |
| http | JA4 fingerprint, TLS impersonation, headless API testing | 10 ms | 20 MB | no | TLS-only |

## Auto-escalation

If you don't know which profile to use, let bunlight pick:

agent-browser --engine bunlight --auto-profile open https://example.com

bunlight will start with `static`. If the response indicates a need for JS (empty body, SPA placeholder), it escalates to `fast`. If 403/Cloudflare/captcha detected, escalates to `stealth`. If still blocked, escalates to `max`.

## Workflow

The standard agent-browser workflow works identically:

1. agent-browser --engine bunlight open <url>
2. agent-browser --engine bunlight snapshot -i
3. agent-browser --engine bunlight click @e1
4. agent-browser --engine bunlight close

## Limitations

- `--profile static` has no JS execution. Cannot click, fill, or evaluate scripts.
- `--profile http` has no DOM interaction beyond snapshot — pure HTTP/TLS layer.
- Browser extensions (`--extension`), Chrome user profiles (`--profile <dir>`), and storage state (`--state`) are not supported with `--engine bunlight`.

## Installation

If `--engine bunlight` returns "Bunlight not found":

curl -sSL https://github.com/bunmium/bunlight/releases/latest/download/bunlight-$(uname -s | tr A-Z a-z)-$(uname -m) -o /usr/local/bin/bunlight && chmod +x /usr/local/bin/bunlight && bunlight install
```

Frontmatter clé : `name: bunlight`, `description: ...` avec triggerwords pour que les LLMs choisissent automatiquement.

## Tâche 2 — Auto-escalation

`bunlight/src/profiles/auto-escalation.ts` :

```ts
import type { Page } from "../api/browser.ts";

export type EscalationStep = "static" | "fast" | "stealth" | "max";
export const ESCALATION_ORDER: EscalationStep[] = ["static", "fast", "stealth", "max"];

export interface EscalationSignal {
  reason: "empty_body" | "spa_placeholder" | "403" | "cloudflare" | "captcha" | "datadome" | "turnstile";
  detectedFromBody?: string;
  detectedFromStatus?: number;
}

export function detectEscalationSignal(body: string, status: number): EscalationSignal | null {
  if (status === 403) return { reason: "403", detectedFromStatus: status };
  if (status === 503 && /cloudflare/i.test(body)) return { reason: "cloudflare" };
  if (/Just a moment/i.test(body)) return { reason: "cloudflare" };
  if (/Checking your browser/i.test(body)) return { reason: "cloudflare" };
  if (/cf-mitigated/i.test(body)) return { reason: "cloudflare" };
  if (/Access Denied/i.test(body) && /datadome/i.test(body)) return { reason: "datadome" };
  if (/turnstile/i.test(body) && /captcha/i.test(body)) return { reason: "turnstile" };
  if (/<noscript>/i.test(body) && body.length < 1000) return { reason: "spa_placeholder" };
  if (body.length < 100) return { reason: "empty_body" };
  return null;
}

export function nextProfile(current: EscalationStep): EscalationStep | null {
  const idx = ESCALATION_ORDER.indexOf(current);
  if (idx === -1 || idx >= ESCALATION_ORDER.length - 1) return null;
  return ESCALATION_ORDER[idx + 1];
}

export async function autoEscalate(
  url: string,
  options: { startProfile?: EscalationStep; maxAttempts?: number } = {}
): Promise<{ profile: EscalationStep; page: Page; attempts: EscalationStep[] }> {
  let profile = options.startProfile ?? "static";
  const attempts: EscalationStep[] = [];

  for (let i = 0; i < (options.maxAttempts ?? 4); i++) {
    attempts.push(profile);
    const launchProfile = await import(`./${profile}/index.ts`).then(m => m.launch);
    const page = await launchProfile().then((b: any) => b.newPage());
    const response = await page.navigate(url);
    const body = await page.content();
    const signal = detectEscalationSignal(body, response.status);

    if (!signal) {
      return { profile, page, attempts };
    }

    await page.close();
    const next = nextProfile(profile);
    if (!next) {
      throw new Error(`Auto-escalation exhausted at ${profile} (last signal: ${signal.reason})`);
    }
    profile = next;
  }

  throw new Error(`Auto-escalation max attempts reached`);
}
```

Wirage dans `src/cli/serve.ts` : ajouter `--auto-profile` flag. Quand actif, le profile est résolu dynamiquement à la première navigation.

## Tests

`test/integration/auto-escalation.test.ts` :
- HN HTTP-only → static suffit
- React.dev empty body → escalate fast
- Challonge cloudflare → escalate stealth
- Mock fail tous → throw

## Done

- SKILL.md complet et trigger-rich
- auto-escalation.ts implémenté + wired dans serve.ts
- 5+ tests pass
- state.md §4
- status.json 05b → `completed`
