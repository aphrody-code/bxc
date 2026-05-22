use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use deno_core::serde::Deserialize as DeserializeTrait;
use deno_core::serde_json::{self, Value};
use deno_core::url::Url;
use deno_core::JsRuntime;
use deno_core::RuntimeOptions;
use deno_core::PollEventLoopOptions;
use deno_core::v8;
use crate::module_loader::ObscuraModuleLoader;
use crate::ops;
use ::obscura_dom::DomTree;
use obscura_net::{CookieJar, ObscuraHttpClient};
use tokio::sync::mpsc;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteObjectInfo {
    pub object_id: Option<String>,
    pub value: Value,
    pub description: Option<String>,
    pub js_type: String,
    pub subtype: Option<String>,
    pub class_name: String,
}

pub struct ObscuraJsRuntime {
    pub runtime: JsRuntime,
    pub state: ops::SharedState,
}

impl ObscuraJsRuntime {
    pub fn new(base_url: &str) -> Self {
        Self::with_base_url_and_proxy(base_url, None)
    }

    pub fn with_base_url_and_proxy(base_url: &str, proxy_url: Option<String>) -> Self {
        let state = Rc::new(RefCell::new(ops::ObscuraState::new()));
        state.borrow_mut().url = base_url.to_string();

        let ext = ops::build_extension();

        let runtime = JsRuntime::new(RuntimeOptions {
            module_loader: Some(Rc::new(ObscuraModuleLoader::with_proxy(
                base_url,
                proxy_url,
            ))),
            extensions: vec![ext],
            ..Default::default()
        });

        runtime.op_state().borrow_mut().put(state.clone());

        let mut rt = ObscuraJsRuntime { runtime, state };
        
        // Inject bootstrap shims
        let bootstrap = r#"
            globalThis.window = globalThis;
            globalThis.self = globalThis;
            
            const { op_sleep, op_console_msg, op_dom } = Deno.core.ops;
            
            globalThis.setTimeout = (cb, delay) => {
                const id = Math.floor(Math.random() * 1000000);
                op_sleep(delay || 0).then(() => {
                    if (typeof cb === 'string') eval(cb);
                    else if (typeof cb === 'function') cb();
                });
                return id;
            };
            
            globalThis.clearTimeout = () => {};
            globalThis.setInterval = (cb, delay) => {
                const loop = () => {
                    op_sleep(delay || 0).then(() => {
                        if (typeof cb === 'function') cb();
                        loop();
                    });
                };
                loop();
                return 1;
            };
            globalThis.clearInterval = () => {};

            globalThis.console = {
                log: (...args) => op_console_msg('info', args.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ')),
                info: (...args) => op_console_msg('info', args.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ')),
                warn: (...args) => op_console_msg('warn', args.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ')),
                error: (...args) => op_console_msg('error', args.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ')),
            };

            // Enhanced document shim
            globalThis.document = {
                get cookie() { return Deno.core.ops.op_get_cookies(); },
                set cookie(v) { Deno.core.ops.op_set_cookie(v); },
                get title() { return JSON.parse(op_dom('document_title', '', '')); },
                set title(v) { Deno.core.ops.op_console_msg('info', 'title set to: ' + v); },
                get location() { return globalThis.location; },
                get documentElement() { return { scrollWidth: 1024, scrollHeight: 768 }; },
                get body() {
                    const b = {
                        appendChild: function(c) { return c; },
                        removeChild: function(c) { return c; },
                        prepend: function() {},
                        append: function() {},
                    };
                    return b;
                },
                get head() {
                    const h = {
                        appendChild: function(c) { return c; },
                        removeChild: function(c) { return c; },
                        prepend: function() {},
                        append: function() {},
                    };
                    return h;
                },
                createElement: (tag) => ({
                    tagName: tag.toUpperCase(),
                    style: {},
                    appendChild: function(c) { return c; },
                    removeChild: function(c) { return c; },
                    prepend: function() {},
                    append: function() {},
                    setAttribute: function() {},
                    getAttribute: function() { return null; },
                    addEventListener: function() {},
                    removeEventListener: function() {},
                }),
                getElementById: (id) => {
                    const nid = op_dom('get_element_by_id', id, '');
                    if (nid === '-1') return null;
                    return makeElement(nid);
                },
                querySelector: (sel) => {
                    const nid = op_dom('query_selector', sel, '');
                    if (nid === '-1') return null;
                    return makeElement(nid);
                },
                querySelectorAll: (sel) => {
                    const nids = JSON.parse(op_dom('query_selector_all', sel, ''));
                    return nids.map(nid => makeElement(String(nid)));
                },
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => true,
            };

            function makeElement(nid) {
                return {
                    get tagName() { return JSON.parse(op_dom('tag_name', nid, '')); },
                    get textContent() { return JSON.parse(op_dom('text_content', nid, '')); },
                    get innerHTML() { return JSON.parse(op_dom('inner_html', nid, '')); },
                    get outerHTML() { return JSON.parse(op_dom('outer_html', nid, '')); },
                    getAttribute: (name) => {
                        const val = JSON.parse(op_dom('get_attribute', nid, name));
                        return val;
                    },
                    setAttribute: (name, val) => { op_dom('set_attribute', nid, name + '\0' + val); },
                    appendChild: (c) => { op_dom('append_child', nid, c.nid); return c; },
                    remove: () => { op_dom('remove_child', nid, ''); },
                    addEventListener: () => {},
                    removeEventListener: () => {},
                    get nid() { return nid; },
                    style: {},
                    href: JSON.parse(op_dom('get_attribute', nid, 'href')) || '',
                };
            }
            
            globalThis.location = {
                get href() { return JSON.parse(op_dom('document_url', '', '')); },
                set href(v) { Deno.core.ops.op_navigate(v, 'GET', ''); },
                reload: () => {
                    const url = JSON.parse(op_dom('document_url', '', ''));
                    Deno.core.ops.op_navigate(url, 'GET', '');
                }
            };

            globalThis.performance = {
                now: () => Date.now(),
            };
            globalThis.Event = class Event { constructor(type) { this.type = type; } };
            globalThis.navigator = {
                userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                platform: 'Linux x86_64',
                languages: ['en-US', 'en'],
                webdriver: false,
            };
        "#;
        
        let _ = rt.runtime.execute_script("<bootstrap>", bootstrap.to_string());

        rt
    }

    pub fn set_url(&mut self, url: &str) {
        self.state.borrow_mut().url = url.to_string();
    }

    pub fn set_title(&mut self, title: &str) {
        self.state.borrow_mut().title = title.to_string();
    }

    pub fn set_user_agent(&mut self, _ua: &str) {}

    pub fn set_cookie_jar(&mut self, jar: Arc<CookieJar>) {
        self.state.borrow_mut().cookie_jar = Some(jar);
    }

    pub fn set_http_client(&mut self, client: Arc<ObscuraHttpClient>) {
        self.state.borrow_mut().http_client = Some(client);
    }

    pub fn set_intercept_tx(&self, tx: mpsc::UnboundedSender<ops::InterceptedRequest>) {
        let mut gs = self.state.borrow_mut();
        gs.intercept_tx = Some(tx);
        gs.intercept_enabled = true;
    }

    pub fn set_dom(&mut self, dom: DomTree) {
        self.state.borrow_mut().dom = Some(dom);
    }

    pub fn take_dom(&self) -> Option<DomTree> {
        self.state.borrow_mut().dom.take()
    }

    pub fn with_dom<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&DomTree) -> R,
    {
        let gs = self.state.borrow();
        let dom = gs.dom.as_ref().expect("DOM not initialized in JS runtime");
        f(dom)
    }

    pub async fn execute_script(&mut self, name: &str, source: &str) -> Result<Value, String> {
        let result = self.runtime.execute_script(name.to_string(), source.to_string())
            .map_err(|e| e.to_string())?;
        self.v8_to_json(result)
    }

    pub fn execute_script_guarded(&mut self, name: &str, source: &str) -> Result<Value, String> {
        let result = self.runtime.execute_script(name.to_string(), source.to_string())
            .map_err(|e| e.to_string())?;
        self.v8_to_json(result)
    }

    pub fn evaluate(&mut self, source: &str) -> Result<Value, String> {
        // Pass `"<eval>"` as `&'static str` — deno_core accepts it directly
        // via `IntoModuleName for &'static str`, avoiding an allocation.
        let result = self.runtime.execute_script("<eval>", source.to_string())
            .map_err(|e| e.to_string())?;
        self.v8_to_json(result)
    }

    pub async fn load_module(&mut self, url: &str) -> Result<(), String> {
        let specifier = Url::parse(url).map_err(|e| e.to_string())?;
        let mod_id = self.runtime.load_main_es_module(&specifier).await.map_err(|e| e.to_string())?;
        let _ = self.runtime.mod_evaluate(mod_id);
        self.runtime.run_event_loop(Default::default()).await.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn load_inline_module(&mut self, source: &str, base_url: &str) -> Result<(), String> {
        let specifier = Url::parse(base_url).map_err(|e| e.to_string())?;
        let mod_id = self.runtime.load_side_es_module_from_code(&specifier, source.to_string()).await.map_err(|e| e.to_string())?;
        let _ = self.runtime.mod_evaluate(mod_id);
        self.runtime.run_event_loop(Default::default()).await.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn run_event_loop(&mut self) -> Result<(), String> {
        self.runtime.run_event_loop(Default::default()).await.map_err(|e| e.to_string())
    }

    pub fn take_pending_navigation(&self) -> Option<(String, String, String)> {
        self.state.borrow_mut().pending_navigation.take()
    }

    pub fn set_blocked_urls(&self, urls: Vec<String>) {
        self.state.borrow_mut().blocked_urls = urls;
    }

    pub async fn evaluate_for_cdp(&mut self, expression: &str, _return_by_value: bool, _await_promise: bool) -> Result<RemoteObjectInfo, String> {
        let val = self.evaluate(expression)?;
        Ok(RemoteObjectInfo {
            object_id: None,
            value: val.clone(),
            description: Some(val.to_string()),
            js_type: "object".to_string(),
            subtype: None,
            class_name: "Object".to_string(),
        })
    }

    pub async fn call_function_on_for_cdp(&mut self, _declaration: &str, _object_id: Option<&str>, _args: &[Value], _return_by_value: bool, _await_promise: bool) -> Result<RemoteObjectInfo, String> {
        Err("call_function_on_for_cdp not implemented".to_string())
    }

    pub fn store_object_with_meta(&mut self, expression: &str) -> Result<RemoteObjectInfo, String> {
        let val = self.evaluate(expression)?;
        Ok(RemoteObjectInfo {
            object_id: None,
            value: val.clone(),
            description: Some(val.to_string()),
            js_type: "object".to_string(),
            subtype: Some("node".to_string()),
            class_name: "HTMLElement".to_string(),
        })
    }

    pub fn release_object(&mut self, _object_id: &str) {}
    pub fn release_object_group(&mut self) {}

    fn v8_to_json(&mut self, result: v8::Global<v8::Value>) -> Result<serde_json::Value, String> {
        let context = self.runtime.main_context();
        let isolate = self.runtime.v8_isolate();
        v8::scope!(scope, isolate);
        let context = v8::Local::new(scope, context);
        let scope = &mut v8::ContextScope::new(scope, context);
        
        let local = v8::Local::new(scope, result);

        if local.is_undefined() || local.is_null() {
            return Ok(serde_json::Value::Null);
        }

        let deserializer = &mut deno_core::serde_v8::Deserializer::new(scope, local, None);
        deno_core::serde::Deserialize::deserialize(deserializer).map_err(|e| e.to_string())
    }
}
