#[cxx::bridge]
pub mod ffi {
    // Declarations for C++ APIs that we want to call from Rust.
    unsafe extern "C++" {
        // Ces headers seront fournis par le source tree Chromium lors du linking GN
        // include!("chrome/browser/ui/browser.h");
        // include!("content/public/browser/web_contents.h");

        // type Browser;
        // type WebContents;

        // fn get_active_web_contents(browser: &Browser) -> &WebContents;
    }

    // Rust types and signatures exposed to C++.
    extern "Rust" {
        fn process_dom_snapshot(html_payload: &str) -> String;
    }
}

use lol_html::{rewrite_str, element, RewriteStrSettings};

pub fn process_dom_snapshot(html_payload: &str) -> String {
    // Ultra-fast HTML parsing using lol_html
    let element_content_handlers = vec![
        element!("script", |el| {
            el.remove();
            Ok(())
        }),
        element!("style", |el| {
            el.remove();
            Ok(())
        }),
        element!("svg", |el| {
            el.remove();
            Ok(())
        })
    ];
    
    let result = rewrite_str(
        html_payload,
        RewriteStrSettings {
            element_content_handlers,
            ..RewriteStrSettings::default()
        }
    ).unwrap();
    
    result
}
