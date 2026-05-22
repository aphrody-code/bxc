use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use obscura_dom::DomTree;

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
    
    let markdown = obscura_dom::html_to_markdown(html_payload);
    let c_string = CString::new(markdown).unwrap_or_default();
    c_string.into_raw()
}
