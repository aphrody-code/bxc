# Guide des SDK Google pour Rust (Official 2026)

## 🏗️ L'Official SDK : `google-cloud-rust`
En 2026, Google maintient officiellement un SDK Rust performant sur Crates.io.

### Bibliothèques clés :
- `google-cloud-storage`
- `google-cloud-pubsub`
- `google-cloud-bigquery`
- `google-cloud-googleapis` (pour l'accès direct aux définitions gRPC)

## ⚡ Pourquoi Rust ?
- **Performance gRPC** : Utilisation native de `tonic` pour une latence minimale.
- **Sécurité Mémoire** : Zéro segmentation fault dans vos microservices.
- **Cold Start** : Record de vitesse sur Cloud Run (~10ms).

## 🛠️ Exemple : Client Storage Async (2026)

```rust
use google_cloud_storage::client::{Client, ClientConfig};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // ADC via GOOGLE_APPLICATION_CREDENTIALS
    let config = ClientConfig::default().with_auth().await?;
    let client = Client::new(config);

    // Liste des objets dans un bucket
    let objects = client.list_objects("mon-bucket").await?;
    for obj in objects.items {
        println!("Objet trouvé : {}", obj.name);
    }
    
    Ok(())
}
```

## 📦 Cargo.toml recommandé
```toml
[dependencies]
google-cloud-storage = "0.20"
tokio = { version = "1.40", features = ["full"] }
tonic = "0.12"
```
