# 02f — Agent `cdp-emulation-security`

**Phase** : 1
**Subagent type** : `typescript-pro`
**Durée estimée** : 1-1.5h

## Mission

Passer les Emulation.* / Security.* de stubs no-op à implémentations réelles dans `bunlight/src/cdp/domains/{Emulation,Security}.ts`. Important pour `agent-browser set device`, `set geo`, `set credentials`, `--ignore-https-errors`.

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `bunlight/src/cdp/domains/{Emulation,Security}.ts` (Phase 0 stubs no-op)
3. `bunlight/src/transport/StaticDomTransport.ts` (les 5 stubs Emulation existants)

## Scope strict

**Touche** :
- `bunlight/src/cdp/domains/{Emulation,Security}.ts`
- `bunlight/test/cdp/domains/{Emulation,Security}.test.ts`
- `bunlight/docs/CDP-COVERAGE.md`

## Methods Emulation.* à implémenter (vrais comportements)

| Method | Static | fast/stealth/max | http |
|---|---|---|---|
| `Emulation.setDeviceMetricsOverride` | Store {width, height, deviceScaleFactor, mobile} dans page state, applique à `Browser.setContentsSize` proxy + screenshot dimensions | Delegate (Chrome native) | Store, applique sur viewport reporting |
| `Emulation.clearDeviceMetricsOverride` | Reset to default 1280x720 | Delegate | Reset |
| `Emulation.setEmulatedMedia` | Store media type (screen/print) + features (prefers-color-scheme: dark/light) | Delegate | Store |
| `Emulation.setUserAgentOverride` | Store UA. Inject dans next fetch User-Agent header | Delegate | Apply via curl-impersonate User-Agent override |
| `Emulation.setGeolocationOverride` | Store {lat, lng, accuracy}, no-op functional (pas de JS geo en static) | Delegate | No-op |
| `Emulation.setLocaleOverride` | Store locale, applique dans Accept-Language header next fetch | Delegate | Apply |
| `Emulation.setTimezoneOverride` | Store timezone | Delegate | No-op |
| `Emulation.setTouchEmulationEnabled` | No-op (pas de touch en static) | Delegate | No-op |
| `Emulation.setScrollbarsHidden` | No-op | Delegate | No-op |

L'idée : passer du stub pur `return {}` à un vrai store + side-effect au prochain navigate (UA dans header, etc.).

## Methods Security.*

| Method | Static | fast/stealth/max | http |
|---|---|---|---|
| `Security.setIgnoreCertificateErrors` | Store flag, applique à `tls: { rejectUnauthorized: !ignore }` au next fetch | Delegate | Apply via curl-impersonate `--insecure` |

## Tests à créer

`test/cdp/domains/Emulation.test.ts` (12 tests) :
- setUserAgentOverride puis Page.navigate → vérifier le User-Agent header dans le request emit Network.requestWillBeSent
- setLocaleOverride "fr-FR" puis Page.navigate → vérifier Accept-Language: fr-FR
- setDeviceMetricsOverride 375×812 puis screenshot → bounds correct
- setEmulatedMedia "dark" → vérifier que stocké correctement (consultable via getter)

`test/cdp/domains/Security.test.ts` (4 tests) :
- setIgnoreCertificateErrors true puis fetch sur self-signed → success
- setIgnoreCertificateErrors false (default) → reject sur self-signed

## Verification

```bash
cd ~/bunmium/bunlight
bun test test/cdp/domains/{Emulation,Security}.test.ts
bun test
```

## Done

- 2 fichiers étoffés
- 16 tests pass
- CDP-COVERAGE.md mis à jour
- task `completed`
- state.md §4
- status.json 02f → `completed`
