use std::sync::Arc;
use std::sync::mpsc;
use std::thread;
use obscura_browser::{BrowserContext, Page};
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

pub enum ObscuraTask {
    Init { proxy: Option<String> },
    Navigate { url: String, tx: mpsc::Sender<String> },
    Query { selector: String, tx: mpsc::Sender<Vec<String>> },
}

static mut TASK_TX: Option<mpsc::Sender<ObscuraTask>> = None;
static START_WORKER: std::sync::Once = std::sync::Once::new();

fn start_obscura_worker() {
    START_WORKER.call_once(|| {
        let (tx, rx) = mpsc::channel::<ObscuraTask>();
        unsafe {
            TASK_TX = Some(tx);
        }

        thread::spawn(move || {
            let mut page_opt: Option<Page> = None;
            
            // Create a tokio runtime for the worker thread
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();

            rt.block_on(async {
                for task in rx {
                    match task {
                        ObscuraTask::Init { proxy } => {
                            let context = Arc::new(BrowserContext::with_options(
                                "bxc-default".to_string(),
                                proxy,
                                true,
                            ));
                            page_opt = Some(Page::new("main".to_string(), context));
                        }
                        ObscuraTask::Navigate { url, tx } => {
                            let result = if let Some(ref mut page) = page_opt {
                                match page.navigate(&url).await {
                                    Ok(_) => {
                                        let val = page.evaluate(obscura_browser::HTML_TO_MARKDOWN_JS);
                                        val.as_str().unwrap_or("").to_string()
                                    }
                                    Err(e) => format!("Error: {:?}", e),
                                }
                            } else {
                                "Error: Obscura not initialized".to_string()
                            };
                            let _ = tx.send(result);
                        }
                        ObscuraTask::Query { selector, tx } => {
                            let results = if let Some(ref mut page) = page_opt {
                                let js = format!(
                                    "JSON.stringify(Array.from(document.querySelectorAll({:?})).map(el => el.outerHTML))",
                                    selector
                                );
                                let val = page.evaluate(&js);
                                let json = val.as_str().unwrap_or("[]");
                                serde_json::from_str::<Vec<String>>(json).unwrap_or_default()
                            } else {
                                vec!["Error: Obscura not initialized".to_string()]
                            };
                            let _ = tx.send(results);
                        }
                    }
                }
            });
        });
    });
}

#[no_mangle]
pub extern "C" fn bxc_obscura_init(proxy_ptr: *const c_char) -> bool {
    start_obscura_worker();
    
    let proxy = if proxy_ptr.is_null() {
        None
    } else {
        let c_str = unsafe { CStr::from_ptr(proxy_ptr) };
        c_str.to_str().ok().map(|s| s.to_string())
    };

    unsafe {
        if let Some(ref tx) = TASK_TX {
            let _ = tx.send(ObscuraTask::Init { proxy });
            return true;
        }
    }
    false
}

#[no_mangle]
pub extern "C" fn bxc_obscura_navigate(url_ptr: *const c_char) -> *mut c_char {
    start_obscura_worker();

    if url_ptr.is_null() {
        return std::ptr::null_mut();
    }
    
    let c_str = unsafe { CStr::from_ptr(url_ptr) };
    let url = match c_str.to_str() {
        Ok(s) => s.to_string(),
        Err(_) => return std::ptr::null_mut(),
    };

    let (tx, rx) = mpsc::channel();
    unsafe {
        if let Some(ref global_tx) = TASK_TX {
            let _ = global_tx.send(ObscuraTask::Navigate { url, tx });
        } else {
             return CString::new("Error: Worker not started").unwrap().into_raw();
        }
    }

    let result = rx.recv().unwrap_or_else(|_| "Error: Worker disconnected".to_string());
    CString::new(result).unwrap().into_raw()
}

#[no_mangle]
pub extern "C" fn bxc_obscura_query(selector_ptr: *const c_char) -> *mut c_char {
    start_obscura_worker();

    if selector_ptr.is_null() {
        return std::ptr::null_mut();
    }
    
    let c_str = unsafe { CStr::from_ptr(selector_ptr) };
    let selector = match c_str.to_str() {
        Ok(s) => s.to_string(),
        Err(_) => return std::ptr::null_mut(),
    };

    let (tx, rx) = mpsc::channel();
    unsafe {
        if let Some(ref global_tx) = TASK_TX {
            let _ = global_tx.send(ObscuraTask::Query { selector, tx });
        } else {
             return CString::new("[]").unwrap().into_raw();
        }
    }

    let result = rx.recv().unwrap_or_default();
    let json = serde_json::to_string(&result).unwrap_or_else(|_| "[]".to_string());
    CString::new(json).unwrap().into_raw()
}
