use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use obscura_dom::{DomTree};
use anyhow::anyhow;
use x_client::{XClient, XSession};

#[no_mangle]
pub extern "C" fn bxc_parse_html(html_ptr: *const c_char) -> *mut DomTree {
    if html_ptr.is_null() {
        return std::ptr::null_mut();
    }
    
    let c_str = unsafe { CStr::from_ptr(html_ptr) };
    let html = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    
    let tree = obscura_dom::parse_html(html);
    Box::into_raw(Box::new(tree))
}

#[no_mangle]
pub extern "C" fn bxc_tree_destroy(tree_ptr: *mut DomTree) {
    if tree_ptr.is_null() {
        return;
    }
    unsafe {
        let _ = Box::from_raw(tree_ptr);
    }
}

#[no_mangle]
pub extern "C" fn bxc_query_selector(tree_ptr: *mut DomTree, selector_ptr: *const c_char) -> *mut c_char {
    if tree_ptr.is_null() || selector_ptr.is_null() {
        return std::ptr::null_mut();
    }
    
    let tree = unsafe { &*tree_ptr };
    let c_str = unsafe { CStr::from_ptr(selector_ptr) };
    let selector = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    
    match tree.query_selector(selector) {
        Ok(Some(id)) => {
            let html = tree.outer_html(id);
            CString::new(html).unwrap().into_raw()
        }
        _ => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "C" fn bxc_query_selector_all(tree_ptr: *mut DomTree, selector_ptr: *const c_char) -> *mut c_char {
    if tree_ptr.is_null() || selector_ptr.is_null() {
        return std::ptr::null_mut();
    }
    
    let tree = unsafe { &*tree_ptr };
    let c_str = unsafe { CStr::from_ptr(selector_ptr) };
    let selector = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    
    match tree.query_selector_all(selector) {
        Ok(ids) => {
            let results: Vec<String> = ids.into_iter().map(|id| tree.outer_html(id)).collect();
            let json = serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string());
            CString::new(json).unwrap().into_raw()
        }
        Err(_) => CString::new("[]").unwrap().into_raw(),
    }
}

#[no_mangle]
pub extern "C" fn bxc_free_string(s: *mut c_char) {
    if s.is_null() {
        return;
    }
    unsafe {
        let _ = CString::from_raw(s);
    }
}

#[no_mangle]
pub extern "C" fn bxc_extract_title(html_ptr: *const c_char) -> *mut c_char {
    if html_ptr.is_null() {
        return std::ptr::null_mut();
    }
    
    let c_str = unsafe { CStr::from_ptr(html_ptr) };
    let html = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    
    // Fast native title extraction using lol_html or simple string finding
    // For extreme speed, simple finding
    let start_tag = "<title>";
    let end_tag = "</title>";
    
    if let Some(start_idx) = html.find(start_tag).or_else(|| html.find("<TITLE>")).or_else(|| html.find("<title ")) {
        let after_start = &html[start_idx..];
        let content_start = after_start.find('>').map(|i| i + 1).unwrap_or(0);
        let content = &after_start[content_start..];
        
        if let Some(end_idx) = content.find(end_tag).or_else(|| content.find("</TITLE>")) {
            let title = content[..end_idx].trim().to_string();
            return CString::new(title).unwrap_or_default().into_raw();
        }
    }
    
    CString::new("").unwrap().into_raw()
}

#[no_mangle]
pub extern "C" fn bxc_strip_tags(html_ptr: *const c_char) -> *mut c_char {
    if html_ptr.is_null() {
        return std::ptr::null_mut();
    }
    
    let c_str = unsafe { CStr::from_ptr(html_ptr) };
    let html = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    
    // Very fast single-pass tag stripping
    let mut result = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    
    for c in html.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(c);
        }
    }
    
    CString::new(result).unwrap_or_default().into_raw()
}

#[no_mangle]
pub extern "C" fn bxc_html_to_markdown(html_ptr: *const c_char) -> *mut c_char {
    if html_ptr.is_null() {
        return std::ptr::null_mut();
    }
    
    let c_str = unsafe { CStr::from_ptr(html_ptr) };
    let html_payload = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    
    let markdown = html2md::parse_html(html_payload);
    let c_string = CString::new(markdown).unwrap_or_default();
    c_string.into_raw()
}

#[no_mangle]
pub extern "C" fn bxc_get_chromium_cookies(
    user_data_path_ptr: *const c_char,
    profile_ptr: *const c_char,
    host_key_ptr: *const c_char,
) -> *mut c_char {
    if user_data_path_ptr.is_null() || profile_ptr.is_null() || host_key_ptr.is_null() {
        return CString::new("[]").unwrap().into_raw();
    }

    let user_data_path = unsafe { CStr::from_ptr(user_data_path_ptr) };
    let profile = unsafe { CStr::from_ptr(profile_ptr) };
    let host_key = unsafe { CStr::from_ptr(host_key_ptr) };

    let user_data_path_str = match user_data_path.to_str() {
        Ok(s) => s,
        Err(_) => return CString::new("[]").unwrap().into_raw(),
    };
    let profile_str = match profile.to_str() {
        Ok(s) => s,
        Err(_) => return CString::new("[]").unwrap().into_raw(),
    };
    let host_key_str = match host_key.to_str() {
        Ok(s) => s,
        Err(_) => return CString::new("[]").unwrap().into_raw(),
    };

    let mut parser = bxc_chromium::ChromiumParser::new(std::path::PathBuf::from(user_data_path_str));
    if let Err(e) = parser.load_master_key() {
        let err_json = serde_json::json!({
            "error": format!("Failed to load master key: {}", e)
        });
        return CString::new(err_json.to_string()).unwrap().into_raw();
    }

    match parser.get_cookies_full(profile_str, host_key_str) {
        Ok(cookies) => {
            let json = serde_json::to_string(&cookies).unwrap_or_else(|_| "[]".to_string());
            CString::new(json).unwrap().into_raw()
        }
        Err(e) => {
            let err_json = serde_json::json!({
                "error": format!("Failed to extract cookies: {}", e)
            });
            CString::new(err_json.to_string()).unwrap().into_raw()
        }
    }
}

#[no_mangle]
pub extern "C" fn bxc_dns_recon(domain_ptr: *const c_char) -> *mut c_char {
    if domain_ptr.is_null() {
        return CString::new("[]").unwrap().into_raw();
    }

    let domain = unsafe { CStr::from_ptr(domain_ptr) };
    let domain_str = match domain.to_str() {
        Ok(s) => s,
        Err(_) => return CString::new("[]").unwrap().into_raw(),
    };

    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(r) => r,
        Err(e) => {
            let err_json = serde_json::json!({
                "error": format!("Failed to create tokio runtime: {}", e)
            });
            return CString::new(err_json.to_string()).unwrap().into_raw();
        }
    };

    let results = rt.block_on(async {
        let recon = obscura_net::dns::DnsRecon::new();
        recon.run_osint(domain_str).await
    });

    match results {
        Ok(subdomains) => {
            let json = serde_json::to_string(&subdomains).unwrap_or_else(|_| "[]".to_string());
            CString::new(json).unwrap().into_raw()
        }
        Err(e) => {
            let err_json = serde_json::json!({
                "error": format!("Failed to run DNS OSINT: {}", e)
            });
            CString::new(err_json.to_string()).unwrap().into_raw()
        }
    }
}

#[no_mangle]
pub extern "C" fn bxc_gemini_web_ask(
    cookie_path_ptr: *const c_char,
    prompt_ptr: *const c_char,
    model_ptr: *const c_char,
) -> *mut c_char {
    if cookie_path_ptr.is_null() || prompt_ptr.is_null() {
        let err_json = serde_json::json!({
            "error": "Null pointer arguments passed to bxc_gemini_web_ask"
        });
        return CString::new(err_json.to_string()).unwrap().into_raw();
    }

    let cookie_path = unsafe { CStr::from_ptr(cookie_path_ptr) };
    let prompt = unsafe { CStr::from_ptr(prompt_ptr) };
    
    let cookie_path_str = match cookie_path.to_str() {
        Ok(s) => s,
        Err(_) => return CString::new("{\"error\":\"Invalid UTF-8 in cookie_path\"}").unwrap().into_raw(),
    };
    let prompt_str = match prompt.to_str() {
        Ok(s) => s,
        Err(_) => return CString::new("{\"error\":\"Invalid UTF-8 in prompt\"}").unwrap().into_raw(),
    };

    let model_str = if model_ptr.is_null() {
        None
    } else {
        match unsafe { CStr::from_ptr(model_ptr) }.to_str() {
            Ok(s) => Some(s),
            Err(_) => None,
        }
    };

    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(r) => r,
        Err(e) => {
            let err_json = serde_json::json!({
                "error": format!("Failed to create tokio runtime: {}", e)
            });
            return CString::new(err_json.to_string()).unwrap().into_raw();
        }
    };

    let results = rt.block_on(async {
        let client = gemini_web::GeminiWebClient::from_cookie_file(cookie_path_str, "en").await;
        match client {
            Ok(c) => c.ask(prompt_str, model_str).await.map_err(|e| anyhow!(e)),
            Err(e) => Err(anyhow!(e)),
        }
    });

    match results {
        Ok(reply) => {
            let res_json = serde_json::json!({
                "text": reply.text,
                "conversation_id": reply.metadata.conversation_id,
                "response_id": reply.metadata.response_id,
                "choice_id": reply.metadata.choice_id,
            });
            CString::new(res_json.to_string()).unwrap().into_raw()
        }
        Err(e) => {
            let err_json = serde_json::json!({
                "error": format!("Failed to execute Gemini request: {}", e)
            });
            CString::new(err_json.to_string()).unwrap().into_raw()
        }
    }
}

// ---------------------------------------------------------------------------
// x-client (X / Twitter private web API) — cookie-auth read wrappers.
//
// Both wrappers authenticate with an `auth_token` + `ct0` cookie pair (the
// CSRF double-submit values lifted from a logged-in browser session). They
// build a fresh single-thread tokio runtime per call, mirroring the gemini
// wrapper above. `XClient::new` installs the ring rustls CryptoProvider
// idempotently, so no extra setup is required here.
// ---------------------------------------------------------------------------

/// Build an [`XClient`] from raw `auth_token` / `ct0` cookie pointers.
///
/// Returns `Err` with a human-readable message on null/invalid-UTF-8 input or
/// HTTP client construction failure.
fn x_build_client(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
) -> std::result::Result<XClient, String> {
    if auth_token_ptr.is_null() || ct0_ptr.is_null() {
        return Err("Null auth_token/ct0 pointer".to_string());
    }
    let auth_token = unsafe { CStr::from_ptr(auth_token_ptr) }
        .to_str()
        .map_err(|_| "Invalid UTF-8 in auth_token".to_string())?;
    let ct0 = unsafe { CStr::from_ptr(ct0_ptr) }
        .to_str()
        .map_err(|_| "Invalid UTF-8 in ct0".to_string())?;

    let session = XSession::new(auth_token, ct0);
    XClient::new(session).map_err(|e| format!("Failed to build X client: {e}"))
}

/// Fetch a public user profile by `@handle` (screen name).
///
/// Returns a JSON-serialised `UserInfo` object, or `{"error":"..."}`.
/// The returned pointer must be released with [`bxc_free_string`].
#[no_mangle]
pub extern "C" fn bxc_x_user_by_screen_name(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
) -> *mut c_char {
    if handle_ptr.is_null() {
        return CString::new("{\"error\":\"Null handle pointer\"}").unwrap().into_raw();
    }
    let handle = match unsafe { CStr::from_ptr(handle_ptr) }.to_str() {
        Ok(s) => s,
        Err(_) => return CString::new("{\"error\":\"Invalid UTF-8 in handle\"}").unwrap().into_raw(),
    };

    let client = match x_build_client(auth_token_ptr, ct0_ptr) {
        Ok(c) => c,
        Err(e) => {
            let err = serde_json::json!({ "error": e });
            return CString::new(err.to_string()).unwrap().into_raw();
        }
    };

    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(r) => r,
        Err(e) => {
            let err = serde_json::json!({ "error": format!("Failed to create tokio runtime: {e}") });
            return CString::new(err.to_string()).unwrap().into_raw();
        }
    };

    let result = rt.block_on(async { client.user_by_screen_name(handle).await });

    match result {
        Ok(info) => {
            let json = serde_json::to_string(&info).unwrap_or_else(|_| "{}".to_string());
            CString::new(json).unwrap().into_raw()
        }
        Err(e) => {
            let err = serde_json::json!({ "error": format!("user_by_screen_name failed: {e}") });
            CString::new(err.to_string()).unwrap().into_raw()
        }
    }
}

/// Fetch up to `count` tweets from a user's timeline by `@handle`.
///
/// Resolves the numeric user id from the handle first, then pulls the
/// `UserTweets` timeline. Returns a JSON-serialised `TweetPage`, or
/// `{"error":"..."}`. The returned pointer must be released with
/// [`bxc_free_string`].
#[no_mangle]
pub extern "C" fn bxc_x_user_tweets(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
    count: u32,
) -> *mut c_char {
    if handle_ptr.is_null() {
        return CString::new("{\"error\":\"Null handle pointer\"}").unwrap().into_raw();
    }
    let handle = match unsafe { CStr::from_ptr(handle_ptr) }.to_str() {
        Ok(s) => s,
        Err(_) => return CString::new("{\"error\":\"Invalid UTF-8 in handle\"}").unwrap().into_raw(),
    };

    let client = match x_build_client(auth_token_ptr, ct0_ptr) {
        Ok(c) => c,
        Err(e) => {
            let err = serde_json::json!({ "error": e });
            return CString::new(err.to_string()).unwrap().into_raw();
        }
    };

    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(r) => r,
        Err(e) => {
            let err = serde_json::json!({ "error": format!("Failed to create tokio runtime: {e}") });
            return CString::new(err.to_string()).unwrap().into_raw();
        }
    };

    let n = if count == 0 { 20 } else { count };
    let result = rt.block_on(async {
        let uid = client.user_id_for(handle).await?;
        client.user_tweets(&uid, n, None, 1).await
    });

    match result {
        Ok(page) => {
            let json = serde_json::to_string(&page).unwrap_or_else(|_| "{}".to_string());
            CString::new(json).unwrap().into_raw()
        }
        Err(e) => {
            let err = serde_json::json!({ "error": format!("user_tweets failed: {e}") });
            CString::new(err.to_string()).unwrap().into_raw()
        }
    }
}

