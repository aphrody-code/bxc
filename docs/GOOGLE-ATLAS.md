# 🗺️ Google Ecosystem Atlas

## The Vision
Bunlight is not just a generic browser engine; it's a Google Ecosystem Stealth Engine. To achieve this, we are building the **Google Ecosystem Atlas**—a comprehensive mapping of 5000+ Google domains, their infrastructure (CDN, GFE, GGC), and the frontend frameworks they use (Wiz, Angular, Lit).

## Why an Atlas?

1. **Intelligent Routing**: Instead of relying on generic stealth parameters, Bunlight can adapt its behavior based on the specific Google property. A site powered by Angular requires different fingerprinting than a site running on Wiz.
2. **Infrastructure Awareness**: By knowing which domains sit behind specific CDNs or network configurations, the `GoogleClient` can pre-configure TLS and networking options to avoid WAF flags.
3. **Automated Parser Factory**: The Atlas provides the DOM structures of thousands of Google pages, allowing us to automatically generate scoped parsers for "Stealth Verticals" (Maps, News, Books, Console).
4. **Resilience Testing**: The Atlas powers a massive suite of smoke tests, ensuring Bunlight maintains 100% visibility across the entire Google ecosystem without triggering CAPTCHAs.

## Current Status (May 2026)

- **Total Audits**: 5637
- **Unique Hosts**: 366
- **Primary Frameworks Detected**:
  - **Wiz**: 20 key properties (Search, Accounts, Cloud Console)
  - **Angular**: developers.google.com
  - **Lit**: io.google
- **Infrastructure**: 100% GFE (Google Front End) detected across all audited endpoints.

## Smart Routing Active
Bunlight now automatically selects the optimal stealth profile based on the Atlas. When navigating to a known Wiz or Angular property, it adjusts its fingerprint and JS execution strategy to match the expected frontend behavior.
