# Index de la documentation Google SDK (Édition 2026)

Bienvenue dans le guide complet et optimisé des SDK Google.

## 📁 Sommaire par langage

1. **[TypeScript (Bun 2026)](typescript.md)**
   - Optimisation I/O avec `Bun.file()`.
   - Cold starts <50ms sur Cloud Run.
2. **[Python (IA & uv)](python.md)**
   - Gestion ultra-rapide avec `uv`.
   - Intégration Gemini 1.5/2.0 Pro.
3. **[Rust (Performance High-End)](rust.md)**
   - Official `google-cloud-rust` SDK.
   - Latence gRPC minimale.

---

## 📊 Comparatif de Performance (2026)

| Critère | TypeScript (Bun) | Rust | Python |
| :--- | :--- | :--- | :--- |
| **Vitesse de dev** | Maximale | Modérée | Élevée |
| **Cold Start** | Excellent (~50ms) | Meilleur (~10ms) | Moyen (~200ms) |
| **Cas d'usage** | APIs, Web, Automation | Microservices, gRPC | IA, ML, Data |
| **Gestion deps** | `bun install` | `cargo` | `uv` |

---

## ⭐ APIs "Stars" de 2026
- **Vertex AI Search** : Recherche sémantique sur vos propres documents.
- **Gemini Flash 2.0** : Le modèle le plus rapide pour les agents autonomes.
- **Cloud Run Jobs** : Exécution de tâches Rust/TS en parallèle à grande échelle.

## 🔑 Rappel Authentification
Utilisez `admin-sa-key.json` via Application Default Credentials (ADC) :
```bash
export GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/admin-sa-key.json"
```
