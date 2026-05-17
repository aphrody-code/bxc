/// Helpers shared across CDP domain handlers.
///
/// The file-scheme detector here is reused by every CDP entrypoint that can
/// trigger a navigation, so we don't end up with one domain enforcing the
/// `--allow-file-access` gate and another silently letting `file://` through
/// (see GHSA-q55h-vfv9-qcr5 and its incomplete-fix variant in
/// `Target.createTarget`).

/// Returns true when `raw` parses as a `file:`-scheme URL, or syntactically
/// starts with `file:` after a possible leading-whitespace strip. Matching is
/// case-insensitive on the scheme so neither `FILE://` nor `File://` slips
/// past callers that gate on `file://`.
pub(crate) fn url_is_file_scheme(raw: &str) -> bool {
    url::Url::parse(raw)
        .map(|u| u.scheme().eq_ignore_ascii_case("file"))
        .unwrap_or_else(|_| {
            raw.trim_start().to_ascii_lowercase().starts_with("file:")
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_plain_file_url() {
        assert!(url_is_file_scheme("file:///etc/passwd"));
    }

    #[test]
    fn matches_case_insensitively() {
        assert!(url_is_file_scheme("FILE:///etc/passwd"));
        assert!(url_is_file_scheme("File:///etc/passwd"));
        assert!(url_is_file_scheme("fIlE:///etc/passwd"));
    }

    #[test]
    fn matches_with_leading_whitespace_fallback() {
        // url::Url::parse rejects leading whitespace, but the syntactic
        // fallback still catches `   file:...` so callers can't be tricked
        // into letting it through.
        assert!(url_is_file_scheme("   file:///etc/passwd"));
    }

    #[test]
    fn rejects_http_https_about_data() {
        assert!(!url_is_file_scheme("http://example.com"));
        assert!(!url_is_file_scheme("https://example.com"));
        assert!(!url_is_file_scheme("about:blank"));
        assert!(!url_is_file_scheme("data:text/plain,hi"));
        assert!(!url_is_file_scheme(""));
    }

    #[test]
    fn rejects_lookalikes_that_are_not_file_scheme() {
        // The URL parser rejects these (no `://`), so the syntactic fallback
        // kicks in. `file` appearing anywhere except as the leading scheme
        // must not match.
        assert!(!url_is_file_scheme("notfile:///x"));
        assert!(!url_is_file_scheme("http://file/"));
    }
}
