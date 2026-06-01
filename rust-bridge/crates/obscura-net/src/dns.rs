// SPDX-License-Identifier: Apache-2.0
use anyhow::Result;
use reqwest::Client;
use serde_json::Value;

pub struct DnsRecon {
    client: Client,
}

impl Default for DnsRecon {
    fn default() -> Self {
        Self::new()
    }
}

impl DnsRecon {
    pub fn new() -> Self {
        Self { client: Client::new() }
    }

    pub async fn fetch_crtsh(&self, domain: &str) -> Result<Vec<String>> {
        let url = format!("https://crt.sh/?q=%.{}&output=json", domain);
        let resp = self.client.get(&url).send().await?;
        if !resp.status().is_success() {
            return Ok(Vec::new());
        }

        let mut results = Vec::new();
        if let Ok(data) = resp.json::<Vec<Value>>().await {
            for entry in data {
                if let Some(name_value) = entry.get("name_value").and_then(|v| v.as_str()) {
                    for line in name_value.split('\n') {
                        results.push(line.to_string());
                    }
                }
            }
        }
        Ok(results)
    }

    pub async fn fetch_hackertarget(&self, domain: &str) -> Result<Vec<String>> {
        let url = format!("https://api.hackertarget.com/hostsearch/?q={}", domain);
        let resp = self.client.get(&url).send().await?;
        if !resp.status().is_success() {
            return Ok(Vec::new());
        }
        let text = resp.text().await?;
        let results = text.lines().map(|l| l.split(',').next().unwrap_or("").to_string()).collect();
        Ok(results)
    }

    pub async fn run_osint(&self, domain: &str) -> Result<Vec<String>> {
        let (crtsh, ht) = tokio::join!(self.fetch_crtsh(domain), self.fetch_hackertarget(domain));

        let mut all = crtsh.unwrap_or_default();
        all.extend(ht.unwrap_or_default());

        all.push(domain.to_string());

        let mut unique: Vec<String> = all
            .into_iter()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| s.ends_with(domain))
            .collect();

        unique.sort();
        unique.dedup();

        Ok(unique)
    }
}
