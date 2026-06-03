# Security Policy

## Supported versions

Only the latest published `@aphrody/bxc` release line receives security
fixes. Pin to a tagged release for production use.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately via GitHub Security Advisories:
<https://github.com/aphrody-code/bxc/security/advisories/new>

Include a description, affected version/commit, reproduction steps, and impact.
We aim to acknowledge within 72 hours.

## Secrets & credentials

- No credentials are committed to this repository. CI generates its registry
  `.npmrc` at runtime from `${NODE_AUTH_TOKEN}` (GitHub Actions secret); the
  tracked-out `.npmrc` is git-ignored.
- The X / Twitter client (`@aphrody/x`, `rust-bridge/crates/x-client`)
  authenticates with a user-supplied `auth_token` + `ct0` cookie pair resolved
  from a local session file or `X_AUTH_TOKEN` / `X_CT0` environment variables.
  Never commit these values.
- The `WEB_BEARER` constant in the X client is X's public web bundle bearer
  (identical for every browser session) — it is not a personal credential.
