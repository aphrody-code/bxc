// SPDX-License-Identifier: Apache-2.0
//! Live smoke test for the Gemini web client.
//!
//! Loads the cookie jar from `~/.aphrody/google-cookies.json`, bootstraps the
//! session tokens off the app page, then:
//!   * always runs a READ-ONLY probe (`get_config_flag`) proving cookie-auth +
//!     bootstrap + batchexecute end-to-end without sending any message;
//!   * if a prompt arg is given, sends it and prints the reply.
//!
//! Usage:
//!   cargo run -p gemini-web --example smoke                 # read-only probe
//!   cargo run -p gemini-web --example smoke -- "your prompt" # also send

use gemini_web::GeminiWebClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // rustls 0.23 requires a CryptoProvider before the first reqwest client.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let client = GeminiWebClient::from_default_cookie_file("en").await?;
    let t = client.transport().tokens();
    println!(
        "bootstrap OK: at={} chars, bl={}, f.sid={}",
        t.at.len(),
        t.bl,
        t.fsid.as_deref().unwrap_or("<none>"),
    );

    // Read-only probe — no message sent.
    match client.get_config_flag("bard_activity_enabled").await {
        Ok(v) => println!("config bard_activity_enabled = {v}"),
        Err(e) => println!("config probe failed: {e}"),
    }

    if let Some(prompt) = std::env::args().nth(1) {
        println!("\nsending: {prompt}");
        let reply = client.ask(&prompt, None).await?;
        println!("reply ({} candidate(s)):\n{}", reply.candidate_count, reply.text);
        println!(
            "thread: cid={:?} rid={:?} rcid={:?}",
            reply.metadata.conversation_id, reply.metadata.response_id, reply.metadata.choice_id,
        );
    }
    Ok(())
}
