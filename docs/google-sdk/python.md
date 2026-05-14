# Guide des SDK Google pour Python (Modern Python 2026)

## 🚀 Le nouveau standard : `uv`
En 2026, l'utilisation de `uv` est recommandée pour gérer les SDK Google avec une vitesse comparable à Bun.
```bash
uv pip install google-cloud-aiplatform google-cloud-storage
```

## 📦 Bibliothèques recommandées

### 1. Vertex AI (`google-cloud-aiplatform`)
Indispensable pour l'IA générative et les pipelines ML.
### 2. Google Cloud Client Libraries
Utilisez les versions avec support complet des **Type Hints** et de **Pydantic v2**.

## 🛠️ Exemple : IA Générative avec Gemini 1.5 Pro

```python
import vertexai
from vertexai.generative_models import GenerativeModel

# ADC (Application Default Credentials) via admin-sa-key.json
vertexai.init(project="rgfr-8927d", location="us-central1")

model = GenerativeModel("gemini-1.5-pro")

def ask_gemini(prompt: str):
    response = model.generate_content(prompt)
    return response.text

print(ask_gemini("Quels sont les avantages de Python 3.13 pour Google Cloud ?"))
```

## 🔒 Sécurité
Pour une gestion sécurisée des secrets, privilégiez toujours :
```python
from google.cloud import secretmanager
client = secretmanager.SecretManagerServiceClient()
```
