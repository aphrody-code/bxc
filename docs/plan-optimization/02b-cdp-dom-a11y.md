# 02b — Agent `cdp-dom-a11y`

**Phase** : 1
**Subagent type** : `typescript-pro`
**Durée estimée** : 1.5-2h

## Mission

Étoffer `bunlight/src/cdp/domains/DOM.ts` et créer le contenu de `bunlight/src/cdp/domains/Accessibility.ts`. Critique pour `agent-browser snapshot -i` qui s'appuie sur `Accessibility.getFullAXTree`.

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `bunlight/src/cdp/domains/{DOM,Accessibility}.ts` (Phase 0 stubs)
3. `bunlight/src/ffi/zigquery.ts` (FFI bindings — bl_sel_attr, bl_sel_text, bl_sel_outer_html, bl_sel_tag_name)
4. `bunlight/src/transport/StaticDomTransport.ts` (DOM methods existantes)

## Scope strict

**Touche** :
- `bunlight/src/cdp/domains/DOM.ts`
- `bunlight/src/cdp/domains/Accessibility.ts`
- `bunlight/test/cdp/domains/{DOM,Accessibility}.test.ts`
- `bunlight/docs/CDP-COVERAGE.md` (lignes DOM.* et Accessibility.*)

**NE TOUCHE PAS** : autres domains, FFI lib, transports.

## Methods DOM.* à ajouter (manquantes)

| Method | Static | fast/stealth/max | http |
|---|---|---|---|
| `DOM.enable` | stub → return {} (était stub) | Delegate | return {} |
| `DOM.getBoxModel` | Compute via zigquery (parser bounding box from inline style si présent, sinon defaults width/height/0/0) | Delegate (CDP Chrome) | CDPError "no layout in http" |
| `DOM.resolveNode` | Map nodeId → Runtime.RemoteObject (objectId synthétique) | Delegate | CDPError |
| `DOM.setFileInputFiles` | CDPError "no JS exec in static" | Delegate | CDPError |

## Methods Accessibility.* à créer (rien n'existe)

| Method | Static | fast/stealth/max | http |
|---|---|---|---|
| `Accessibility.enable` | return {} | Delegate | return {} |
| `Accessibility.getFullAXTree` | Construire l'AX tree depuis le DOM zigquery — voir détail ci-dessous | Delegate | CDPError |
| `Accessibility.getPartialAXTree` | Idem getFullAXTree mais scoped à un nodeId | Delegate | CDPError |

## Implémentation `Accessibility.getFullAXTree` en static

C'est LE plus important pour agent-browser snapshot. Algorithme :

1. Récupère le DOM tree via zigquery (`bl_doc_root`, recurse via children — extension ZIGQUERY si nécessaire).
2. Pour chaque node DOM, déduis le `role` ARIA depuis :
   - L'attribut `role` explicite si présent
   - Sinon, mapping tag → role (button → button, a → link, h1-h6 → heading, input[type=text] → textbox, etc.)
   - Sinon, "generic" / "none"
3. Calcule `name` (texte accessible) :
   - `aria-label` > `aria-labelledby` (résolu) > `<label for=...>` text > placeholder > inner text
4. Attributs CDP AX :
   - level pour heading, checked pour checkbox/radio, disabled, focused, hidden, etc.
5. Retourne `{ nodes: AXNode[] }` où AXNode :
   ```ts
   {
     nodeId: string,         // unique global counter
     ignored: boolean,
     role: { type: "role", value: string },
     name?: { type: "computedString", value: string },
     properties?: AXProperty[],
     childIds?: string[],
     backendDOMNodeId?: number,  // référence au DOM node
   }
   ```

Cas spéciaux : hidden inputs (display:none + label parent → promote to checkbox/radio role), elements sans interactive content (skip).

## Tests à créer

`test/cdp/domains/DOM.test.ts` : 8-10 tests
`test/cdp/domains/Accessibility.test.ts` : 12-15 tests (priorité)
- Snapshot HN-style page → AX tree contient `link role="link"` avec `name`
- Snapshot login form → contient `textbox role="textbox"` `name="Email"`
- Snapshot avec heading h1 + h2 → 2 nodes avec level
- Snapshot avec hidden checkbox via label parent → promu correctement
- getPartialAXTree(nodeId) → subtree only

Charger des fixtures HTML depuis `bunlight/test/fixtures/` (HN, login form, etc).

## Verification

```bash
cd ~/bunmium/bunlight
bun test test/cdp/domains/{DOM,Accessibility}.test.ts
bun test  # 0 regression
```

## Done

- DOM.* étoffé (4 methods)
- Accessibility.* implémenté (3 methods + AX tree builder solide)
- ≥20 nouveaux tests
- CDP-COVERAGE.md mis à jour
- task tasks.json `cdp-dom-a11y` `completed`
- Append state.md §4
- status.json 02b → `completed`
