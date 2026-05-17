use std::pin::Pin;

use deno_core::ModuleLoadResponse;
use deno_core::ModuleLoader;
use deno_core::ModuleSource;
use deno_core::ModuleSourceCode;
use deno_core::ModuleSpecifier;
use deno_core::ResolutionKind;
use deno_core::ModuleLoadReferrer;
use deno_core::ModuleLoadOptions;
use deno_error::JsErrorBox;

pub struct ObscuraModuleLoader {
    pub base_url: String,
    pub proxy_url: Option<String>,
}

impl ObscuraModuleLoader {
    pub fn new(base_url: &str) -> Self {
        Self::with_proxy(base_url, None)
    }

    pub fn with_proxy(base_url: &str, proxy_url: Option<String>) -> Self {
        ObscuraModuleLoader {
            base_url: base_url.to_string(),
            proxy_url,
        }
    }
}

fn io_err(msg: String) -> JsErrorBox {
    JsErrorBox::generic(msg)
}

impl ModuleLoader for ObscuraModuleLoader {
    fn resolve(
        &self,
        specifier: &str,
        referrer: &str,
        _kind: ResolutionKind,
    ) -> Result<ModuleSpecifier, JsErrorBox> {
        let base = if referrer.is_empty()
            || referrer.starts_with('<')
            || referrer == "."
            || referrer == "about:blank"
        {
            &self.base_url
        } else {
            referrer
        };

        deno_core::resolve_import(specifier, base).map_err(|e| JsErrorBox::generic(e.to_string()))
    }

    fn load(
        &self,
        module_specifier: &ModuleSpecifier,
        _maybe_referrer: Option<&ModuleLoadReferrer>,
        _options: ModuleLoadOptions,
    ) -> ModuleLoadResponse {
        let url = module_specifier.to_string();
        let proxy_url = self.proxy_url.clone();
        let specifier = module_specifier.clone();

        ModuleLoadResponse::Async(Pin::from(Box::new(async move {
            let mut builder = reqwest::Client::builder();
            if let Some(ref proxy) = proxy_url {
                if let Ok(p) = reqwest::Proxy::all(proxy) {
                    builder = builder.proxy(p);
                }
            }
            let client = builder.build().map_err(|e| io_err(e.to_string()))?;
            let resp = client.get(&url).send().await.map_err(|e| io_err(e.to_string()))?;
            let code = resp.text().await.map_err(|e| io_err(e.to_string()))?;

            Ok(ModuleSource::new(
                deno_core::ModuleType::JavaScript,
                ModuleSourceCode::String(code.into()),
                &specifier,
                None,
            ))
        })))
    }
}
