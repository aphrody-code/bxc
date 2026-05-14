pub mod chromium_cxx;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

#[no_mangle]
pub extern "C" fn bunlight_process_html(html_ptr: *const c_char) -> *mut c_char {
    if html_ptr.is_null() {
        return std::ptr::null_mut();
    }
    
    let c_str = unsafe { CStr::from_ptr(html_ptr) };
    let html_payload = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    
    let processed = chromium_cxx::process_dom_snapshot(html_payload);
    let c_string = CString::new(processed).unwrap();
    c_string.into_raw()
}

#[no_mangle]
pub extern "C" fn bunlight_free_string(s: *mut c_char) {
    if s.is_null() {
        return;
    }
    unsafe {
        let _ = CString::from_raw(s);
    }
}
