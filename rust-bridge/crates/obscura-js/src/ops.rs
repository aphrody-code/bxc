use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

use deno_core::op2;
use deno_core::OpState;
use deno_core::Extension;
use deno_error::JsError;
use deno_core::url::Url;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ::obscura_dom::{DomTree, NodeData, NodeId};
use obscura_net::{CookieJar, ObscuraHttpClient};
use tokio::sync::Mutex;

pub type InterceptCallback = Arc<Mutex<Option<Box<dyn Fn(String, String, String) -> Option<(u16, String, String)> + Send + Sync>>>>;

#[derive(Debug)]
pub enum InterceptResolution {
    Continue {
        url: Option<String>,
        method: Option<String>,
        headers: Option<HashMap<String, String>>,
        body: Option<String>,
    },
    Fulfill {
        status: u16,
        headers: HashMap<String, String>,
        body: String,
    },
    Fail { reason: String },
}

pub struct InterceptedRequest {
    pub request_id: String,
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub resource_type: String,
    pub resolver: tokio::sync::oneshot::Sender<InterceptResolution>,
}

pub struct ObscuraState {
    pub dom: Option<DomTree>,
    pub url: String,
    pub title: String,
    pub blocked_urls: Vec<String>,
    pub cookie_jar: Option<Arc<CookieJar>>,
    pub http_client: Option<Arc<ObscuraHttpClient>>,
    pub pending_navigation: Option<(String, String, String)>,
    pub intercept_tx: Option<tokio::sync::mpsc::UnboundedSender<InterceptedRequest>>,
    pub intercept_counter: u64,
    pub intercept_enabled: bool,
}

impl ObscuraState {
    pub fn new() -> Self {
        ObscuraState {
            dom: None,
            url: "about:blank".to_string(),
            title: String::new(),
            blocked_urls: Vec::new(),
            cookie_jar: None,
            http_client: None,
            pending_navigation: None,
            intercept_tx: None,
            intercept_counter: 0,
            intercept_enabled: false,
        }
    }
}

pub type SharedState = Rc<RefCell<ObscuraState>>;

#[derive(Debug, thiserror::Error, JsError)]
#[class(generic)]
#[error("{0}")]
pub struct OpError(String);

impl From<anyhow::Error> for OpError {
    fn from(e: anyhow::Error) -> Self {
        OpError(e.to_string())
    }
}

#[op2]
#[string]
fn op_dom(state: &OpState, #[string] cmd: String, #[string] arg1: String, #[string] arg2: String) -> String {
    let gs = state.borrow::<SharedState>().clone();
    let gs = gs.borrow();
    let dom = match &gs.dom {
        Some(d) => d,
        None => return "null".to_string(),
    };

    match cmd.as_str() {
        "document_node_id" => dom.document().index().to_string(),
        "document_title" => serde_json::to_string(&gs.title).unwrap_or("\"\"".into()),
        "document_url" => serde_json::to_string(&gs.url).unwrap_or("\"\"".into()),
        "document_element" => {
            for cid in dom.children(dom.document()) {
                if let Some(n) = dom.get_node(cid) {
                    if n.as_element().map(|name| name.local.as_ref() == "html").unwrap_or(false) {
                        return cid.index().to_string();
                    }
                }
            }
            "-1".into()
        }
        "document_doctype" => {
            for cid in dom.children(dom.document()) {
                if let Some(n) = dom.get_node(cid) {
                    if let ::obscura_dom::NodeData::Doctype { name, public_id, system_id } = &n.data {
                        return serde_json::json!({
                            "name": name,
                            "publicId": public_id,
                            "systemId": system_id,
                            "nodeId": cid.index(),
                        }).to_string();
                    }
                }
            }
            "null".into()
        }
        "get_element_by_id" => {
            dom.get_element_by_id(&arg1).map(|id| id.index().to_string()).unwrap_or("-1".into())
        }
        "query_selector" => {
            dom.query_selector(&arg1).ok().flatten().map(|id| id.index().to_string()).unwrap_or("-1".into())
        }
        "query_selector_all" => {
            let ids: Vec<i32> = dom.query_selector_all(&arg1).ok()
                .map(|ids| ids.iter().map(|id| id.index() as i32).collect()).unwrap_or_default();
            serde_json::to_string(&ids).unwrap_or("[]".into())
        }
        "node_type" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            dom.get_node(NodeId::new(nid)).map(|n| match &n.data {
                NodeData::Document => "9", NodeData::Element { .. } => "1", NodeData::Text { .. } => "3",
                NodeData::Comment { .. } => "8", NodeData::Doctype { .. } => "10", NodeData::ProcessingInstruction { .. } => "7",
            }).unwrap_or("0").into()
        }
        "node_name" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            let name: String = dom.get_node(NodeId::new(nid)).map(|n| match &n.data {
                NodeData::Document => "#document".to_string(), NodeData::Element { name, .. } => name.local.as_ref().to_ascii_uppercase(),
                NodeData::Text { .. } => "#text".to_string(), NodeData::Comment { .. } => "#comment".to_string(),
                NodeData::Doctype { name, .. } => name.clone(), NodeData::ProcessingInstruction { target, .. } => target.clone(),
            }).unwrap_or_default();
            serde_json::to_string(&name).unwrap_or("\"\"".into())
        }
        "text_content" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            serde_json::to_string(&dom.text_content(NodeId::new(nid))).unwrap_or("\"\"".into())
        }
        "parent_node" | "first_child" | "last_child" | "next_sibling" | "prev_sibling" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            dom.get_node(NodeId::new(nid)).and_then(|n| match cmd.as_str() {
                "parent_node" => n.parent, "first_child" => n.first_child,
                "last_child" => n.last_child, "next_sibling" => n.next_sibling,
                "prev_sibling" => n.prev_sibling, _ => None,
            }).map(|id| id.index().to_string()).unwrap_or("-1".into())
        }
        "child_nodes" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            let ids: Vec<i32> = dom.children(NodeId::new(nid)).iter().map(|id| id.index() as i32).collect();
            serde_json::to_string(&ids).unwrap_or("[]".into())
        }
        "tag_name" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            let name = dom.get_node(NodeId::new(nid)).and_then(|n| n.as_element().map(|name| name.local.as_ref().to_ascii_uppercase())).unwrap_or_default();
            serde_json::to_string(&name).unwrap_or("\"\"".into())
        }
        "get_attribute" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            let val = dom.get_node(NodeId::new(nid)).and_then(|n| n.get_attribute(&arg2).map(|s| s.to_string()));
            serde_json::to_string(&val).unwrap_or("null".into())
        }
        "set_attribute" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            let node_id = NodeId::new(nid);
            if let Some((name, value)) = arg2.split_once('\0') {
                if name == "id" {
                    let old_id = dom.get_node(node_id).and_then(|n| n.get_attribute("id").map(|s| s.to_string()));
                    dom.with_node_mut(node_id, |n| n.set_attribute(name, value.to_string()));
                    dom.update_id_index(node_id, old_id.as_deref(), Some(value));
                } else {
                    dom.with_node_mut(node_id, |n| n.set_attribute(name, value.to_string()));
                }
            }
            "true".into()
        }
        "inner_html" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            serde_json::to_string(&dom.inner_html(NodeId::new(nid))).unwrap_or("\"\"".into())
        }
        "outer_html" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            serde_json::to_string(&dom.outer_html(NodeId::new(nid))).unwrap_or("\"\"".into())
        }
        "append_child" => {
            let parent = arg1.parse::<u32>().unwrap_or(0);
            let child = arg2.parse::<u32>().unwrap_or(0);
            dom.append_child(NodeId::new(parent), NodeId::new(child));
            "true".into()
        }
        "remove_child" => {
            let child = arg1.parse::<u32>().unwrap_or(0);
            dom.detach(NodeId::new(child));
            "true".into()
        }
        "insert_before" => {
            let new_node = arg1.parse::<u32>().unwrap_or(0);
            let ref_node = arg2.parse::<u32>().unwrap_or(0);
            dom.insert_before(NodeId::new(ref_node), NodeId::new(new_node));
            "true".into()
        }
        "remove_attribute" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            dom.with_node_mut(NodeId::new(nid), |n| {
                if let NodeData::Element { attrs, .. } = &mut n.data {
                    attrs.retain(|a| a.name.local.as_ref() != arg2.as_str());
                }
            });
            "true".into()
        }
        "set_inner_html" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            let target = NodeId::new(nid);
            let children = dom.children(target);
            for child in children {
                dom.detach(child);
            }
            if !arg2.is_empty() {
                let fragment = ::obscura_dom::parse_fragment(&arg2);
                let import_root = fragment.find_body_or_root();
                dom.import_children_from(target, &fragment, import_root);
            }
            "true".into()
        }
        "set_text_content" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            dom.with_node_mut(NodeId::new(nid), |n| {
                match &mut n.data {
                    NodeData::Text { contents } => { *contents = arg2.clone(); }
                    NodeData::Comment { contents } => { *contents = arg2.clone(); }
                    _ => {}
                }
            });
            "true".into()
        }
        "create_document_fragment" => {
            dom.new_node(NodeData::Document).index().to_string()
        }
        "create_element" => {
            dom.new_node(NodeData::Element {
                name: html5ever::QualName::new(None, html5ever::ns!(html), html5ever::LocalName::from(arg1.as_str())),
                attrs: vec![], template_contents: None, mathml_annotation_xml_integration_point: false,
            }).index().to_string()
        }
        "create_text_node" => {
            dom.new_node(NodeData::Text { contents: arg1.clone() }).index().to_string()
        }
        "create_comment_node" => {
            dom.new_node(NodeData::Comment { contents: arg1.clone() }).index().to_string()
        }
        "element_children" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            let ids: Vec<i32> = dom.children(NodeId::new(nid)).iter()
                .filter(|&&id| dom.get_node(id).map(|n| n.is_element()).unwrap_or(false))
                .map(|id| id.index() as i32).collect();
            serde_json::to_string(&ids).unwrap_or("[]".into())
        }
        "has_child_nodes" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            dom.get_node(NodeId::new(nid)).map(|n| n.first_child.is_some()).unwrap_or(false).to_string()
        }
        "contains" => {
            let nid = arg1.parse::<u32>().unwrap_or(0);
            let other = arg2.parse::<u32>().unwrap_or(0);
            dom.descendants(NodeId::new(nid)).contains(&NodeId::new(other)).to_string()
        }
        _ => "null".into(),
    }
}

#[op2(fast)]
fn op_console_msg(#[string] level: &str, #[string] msg: &str) {
    match level {
        "warn" => tracing::warn!(target: "obscura::console", "{}", msg),
        "error" => tracing::error!(target: "obscura::console", "{}", msg),
        _ => tracing::info!(target: "obscura::console", "{}", msg),
    }
}

fn build_request_client(proxy_url: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none());
    if let Some(proxy) = proxy_url {
        let p = reqwest::Proxy::all(proxy)
            .map_err(|e| format!("Invalid op_fetch_url proxy '{}': {}", proxy, e))?;
        builder = builder.proxy(p);
    }
    builder
        .build()
        .map_err(|e| format!("failed to build reqwest::Client: {}", e))
}

#[op2]
#[string]
async fn op_fetch_url(
    state: Rc<RefCell<OpState>>,
    #[string] url: String,
    #[string] _method: String,
    #[string] _headers_json: String,
    #[string] _body: String,
    #[string] _origin: String,
    #[string] _mode: String,
) -> Result<String, OpError> {
    let proxy_url = {
        let state_borrow = state.borrow();
        let gs = state_borrow.borrow::<SharedState>().clone();
        let gs = gs.borrow();
        gs.http_client.as_ref().and_then(|c| c.proxy_url().map(|s| s.to_string()))
    };

    let client = build_request_client(proxy_url.as_deref()).map_err(|e| OpError(e))?;
    let resp = client.get(&url).send().await.map_err(|e| OpError(e.to_string()))?;
    let body_text = resp.text().await.map_err(|e| OpError(e.to_string()))?;

    Ok(serde_json::json!({
        "status": 200,
        "body": body_text,
        "url": url,
        "headers": {},
    }).to_string())
}

#[op2]
#[string]
fn op_get_cookies(state: &OpState) -> String {
    let gs = state.borrow::<SharedState>().clone();
    let gs = gs.borrow();
    let jar = match &gs.cookie_jar { Some(j) => j, None => return String::new() };
    jar.get_js_visible_cookies(&Url::parse(&gs.url).unwrap())
}

#[op2(fast)]
fn op_set_cookie(state: &OpState, #[string] cookie_str: &str) {
    let gs = state.borrow::<SharedState>().clone();
    let gs = gs.borrow();
    if let Some(ref jar) = gs.cookie_jar {
        jar.set_cookie_from_js(cookie_str, &Url::parse(&gs.url).unwrap());
    }
}

#[op2(fast)]
fn op_navigate(state: &OpState, #[string] url: &str, #[string] method: &str, #[string] body: &str) {
    let gs = state.borrow::<SharedState>().clone();
    let mut gs = gs.borrow_mut();
    gs.url = url.to_string();
    gs.pending_navigation = Some((url.to_string(), method.to_string(), body.to_string()));
}

#[op2]
async fn op_sleep(#[number] ms: u64) {
    tokio::time::sleep(tokio::time::Duration::from_millis(ms)).await;
}

deno_core::extension!(
    obscura_extension,
    ops = [
        op_dom,
        op_console_msg,
        op_fetch_url,
        op_get_cookies,
        op_set_cookie,
        op_navigate,
        op_sleep,
    ],
);

pub fn build_extension() -> Extension {
    obscura_extension::init()
}
