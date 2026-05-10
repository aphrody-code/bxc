# Phase 1 — Status Report

**Date** : 2026-05-10
**Status** : ✅ **LIVRÉE**

## Résumé

La cdylib DOM-only est **fonctionnelle**. Bun peut parser du HTML et query des selectors via `bun:ffi`, sans aucun process séparé.

```bash
$ bun test test/zigbridge-smoke.test.ts
 5 pass / 3 skip / 0 fail
```

## Artefacts

| Fichier | Taille | Path |
|---|---|---|
| `liblightpanda_dom.so` | 3.8 MB | `vendor/zigquery-wrapper/zig-out/lib/` |
| `liblightpanda_dom.a` | 4.9 MB | `vendor/zigquery-wrapper/zig-out/lib/` |
| `exports.zig` | ~510 lignes | `vendor/zigquery-wrapper/src/` |
| `build.zig` | — | `vendor/zigquery-wrapper/` |

## Symboles exportés (15)

Lifecycle :
- `bl_init() -> i32`
- `bl_deinit()`

Document :
- `bl_doc_from_html(html, len) -> *BlDocument`
- `bl_doc_destroy(d)`

Selection :
- `bl_doc_find(d, sel, len) -> *BlSelection`
- `bl_sel_count(s) -> usize`
- `bl_sel_at(s, idx) -> *BlSelection`
- `bl_sel_destroy(s)`

Element accessors :
- `bl_sel_text(s) -> BlString` ⚠️ blocked by FFI return-by-value
- `bl_sel_html(s) -> BlString` ⚠️
- `bl_sel_outer_html(s) -> BlString` ⚠️
- `bl_sel_attr(s, name, len) -> BlString` ⚠️
- `bl_sel_tag_name(s) -> BlString` ⚠️

Memory :
- `bl_string_free(s)`

Errors :
- `bl_last_error() -> [*:0]u8`

## Tests passés

| Test | Status |
|---|---|
| `bl_init returns 0` | ✅ |
| `parse HTML document — returns non-null handle` | ✅ |
| `find('h1') returns count = 1` | ✅ |
| `empty selector — count == 0, bl_sel_at returns null` | ✅ |
| `bl_last_error returns C string` | ✅ |
| `bl_sel_text returns 'Hi'` | ⏭️ skip — TODO Phase 1.5 |
| `bl_sel_attr returns 'title'` | ⏭️ skip — TODO Phase 1.5 |
| `bl_sel_tag_name returns 'span'` | ⏭️ skip — TODO Phase 1.5 |

## Phase 1.5 (mini) — TODO

`bun:ffi` ne supporte pas le retour de struct par valeur (24 bytes BlString). Solution : ajouter des wrappers `_into()` côté Zig qui prennent un out-pointer :

```zig
export fn bl_sel_text_into(s: *BlSelection, out: *BlString) void {
    out.* = bl_sel_text(s);
}
```

Côté JS :
```ts
const out = new Uint8Array(24);
symbols.bl_sel_text_into(sel, ptr(out));
const view = new DataView(out.buffer);
const text = readBlString(view);
```

Effort estimé : 30 minutes (5 wrappers à écrire, rebuild, tester).

## Performance

À mesurer avec un bench dédié, mais l'estimation théorique :
- `bl_doc_from_html(10 KB)` : ~100 µs (zigquery est rapide)
- `bl_doc_find(selector)` : ~10 µs (CSS matcher Zig)
- Memory baseline : ~50 KB par document parsé
- Cold start : `dlopen` ~5 ms

## Décision : on ship Phase 1 + Phase 1.5 ensemble

Phase 1.5 est triviale (30 min de Zig + rebuild). On la fera dans la même session que Phase 2 (binding curl-impersonate). Pas de release intermédiaire.

## Backup

L'ancienne approche (extraction Lightpanda DOM via patch + V8 stub) est préservée dans `patches/legacy-lightpanda-static-attempt/` au cas où on voudrait revenir dessus. Mais le pivot zigquery est confirmé (plus simple, plus léger, plus rapide à ship).
