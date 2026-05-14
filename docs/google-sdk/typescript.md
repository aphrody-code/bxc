# Guide des SDK Google pour TypeScript (Optimisé pour Bun 2026)

## 📦 Bibliothèques recommandées

### 1. Google Cloud Client Libraries (`@google-cloud/`)
En 2026, ces bibliothèques sont nativement optimisées pour Bun et exploitent `bun:ffi` pour des performances accrues.
- **Installation** :
  ```bash
  bun add @google-cloud/storage @google-cloud/compute @google-cloud/pubsub
  ```

### 2. Vertex AI for Node.js (`@google-cloud/vertexai`)
Le SDK de référence pour intégrer Gemini 1.5 Pro et Flash.

## ⚡ Pourquoi utiliser Bun avec Google Cloud ?
- **Cold Starts** : Souvent inférieurs à **50ms** sur Cloud Run.
- **Bun.file()** : Intégration directe avec `@google-cloud/storage` pour des uploads 2x plus rapides.
- **Zéro compilation** : Exécution directe des fichiers `.ts` sans étape de build intermédiaire.

## 🛠️ Exemple : Upload Ultra-Rapide (Bun)

```typescript
import { Storage } from '@google-cloud/storage';

const storage = new Storage({ keyFilename: './admin-sa-key.json' });

async function uploadFile(filePath: string, bucketName: string) {
  const bucket = storage.bucket(bucketName);
  // Bun.file() est optimisé pour les I/O système
  const file = Bun.file(filePath);
  
  await bucket.upload(filePath, {
    gzip: true,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });
  console.log(`${filePath} uploadé via Bun!`);
}
```
