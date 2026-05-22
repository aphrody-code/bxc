//! HTML → Markdown serialization over the native `DomTree`.
//!
//! Replaces the external `html2md` crate (which pulled a second, older
//! html5ever/markup5ever/phf parser stack into the build). Walking our own
//! already-parsed `DomTree` keeps a single parser stack and a single
//! `string_cache`/`phf` version across the workspace.

use crate::tree::{DomTree, NodeData, NodeId};

/// Parse `html` and render it as Markdown in one call.
pub fn html_to_markdown(html: &str) -> String {
    let tree = crate::tree_sink::parse_html(html);
    tree.to_markdown()
}

impl DomTree {
    /// Render the whole document as Markdown.
    pub fn to_markdown(&self) -> String {
        let mut out = String::new();
        self.md_children(self.document(), &mut out, &mut MdCtx::default());
        normalize_blank_lines(&out)
    }
}

#[derive(Default, Clone)]
struct MdCtx {
    /// Active list nesting: `Some(n)` ⇒ ordered list whose next item is `n`,
    /// `None` ⇒ unordered list. Length = nesting depth.
    lists: Vec<Option<u64>>,
    /// Inside a `<pre>` block — emit text verbatim, no inline escaping.
    in_pre: bool,
    /// Quote depth (`<blockquote>`).
    quote: usize,
}

impl DomTree {
    fn md_children(&self, parent: NodeId, out: &mut String, ctx: &mut MdCtx) {
        let mut child = self.with_node(parent, |n| n.first_child).flatten();
        while let Some(id) = child {
            self.md_node(id, out, ctx);
            child = self.with_node(id, |n| n.next_sibling).flatten();
        }
    }

    fn md_node(&self, id: NodeId, out: &mut String, ctx: &mut MdCtx) {
        let node = match self.get_node(id) {
            Some(n) => n,
            None => return,
        };
        match &node.data {
            NodeData::Text { contents } => {
                if ctx.in_pre {
                    out.push_str(contents);
                } else {
                    push_inline_text(out, contents);
                }
            }
            NodeData::Element { name, attrs, .. } => {
                let tag = name.local.as_ref();
                self.md_element(id, tag, attrs, out, ctx);
            }
            NodeData::Document => self.md_children(id, out, ctx),
            _ => {}
        }
    }

    fn md_element(
        &self,
        id: NodeId,
        tag: &str,
        attrs: &[crate::tree::Attribute],
        out: &mut String,
        ctx: &mut MdCtx,
    ) {
        let attr = |name: &str| {
            attrs
                .iter()
                .find(|a| a.name.local.as_ref() == name)
                .map(|a| a.value.as_str())
        };
        match tag {
            // Skip non-rendered content entirely.
            "script" | "style" | "head" | "noscript" | "template" | "svg" | "iframe" => {}

            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                let level = tag.as_bytes()[1] - b'0';
                ensure_block(out);
                for _ in 0..level {
                    out.push('#');
                }
                out.push(' ');
                self.md_inline(id, out, ctx);
                out.push_str("\n\n");
            }

            "p" | "div" | "section" | "article" | "header" | "footer" | "main" => {
                ensure_block(out);
                self.md_children(id, out, ctx);
                ensure_block(out);
            }

            "br" => out.push_str("  \n"),
            "hr" => {
                ensure_block(out);
                out.push_str("---\n\n");
            }

            "strong" | "b" => self.md_wrap(id, "**", out, ctx),
            "em" | "i" => self.md_wrap(id, "*", out, ctx),
            "del" | "s" | "strike" => self.md_wrap(id, "~~", out, ctx),

            "code" if !ctx.in_pre => self.md_wrap(id, "`", out, ctx),
            "code" => self.md_children(id, out, ctx),

            "pre" => {
                ensure_block(out);
                out.push_str("```\n");
                let was = ctx.in_pre;
                ctx.in_pre = true;
                self.md_children(id, out, ctx);
                ctx.in_pre = was;
                if !out.ends_with('\n') {
                    out.push('\n');
                }
                out.push_str("```\n\n");
            }

            "a" => {
                let href = attr("href").unwrap_or_default();
                if href.is_empty() {
                    self.md_inline(id, out, ctx);
                } else {
                    out.push('[');
                    self.md_inline(id, out, ctx);
                    out.push_str("](");
                    out.push_str(href);
                    out.push(')');
                }
            }

            "img" => {
                let src = attr("src").unwrap_or_default();
                let alt = attr("alt").unwrap_or_default();
                if !src.is_empty() {
                    out.push_str("![");
                    out.push_str(alt);
                    out.push_str("](");
                    out.push_str(src);
                    out.push(')');
                }
            }

            "ul" => {
                ensure_block(out);
                ctx.lists.push(None);
                self.md_children(id, out, ctx);
                ctx.lists.pop();
                ensure_block(out);
            }
            "ol" => {
                ensure_block(out);
                let start: u64 = attr("start").and_then(|s| s.parse().ok()).unwrap_or(1);
                ctx.lists.push(Some(start));
                self.md_children(id, out, ctx);
                ctx.lists.pop();
                ensure_block(out);
            }
            "li" => {
                let depth = ctx.lists.len().saturating_sub(1);
                for _ in 0..depth {
                    out.push_str("  ");
                }
                match ctx.lists.last_mut() {
                    Some(Some(n)) => {
                        out.push_str(&n.to_string());
                        out.push_str(". ");
                        *n += 1;
                    }
                    _ => out.push_str("- "),
                }
                self.md_inline(id, out, ctx);
                if !out.ends_with('\n') {
                    out.push('\n');
                }
            }

            "blockquote" => {
                ensure_block(out);
                ctx.quote += 1;
                let mut inner = String::new();
                self.md_children(id, &mut inner, ctx);
                ctx.quote -= 1;
                for line in inner.trim_end().lines() {
                    out.push_str("> ");
                    out.push_str(line);
                    out.push('\n');
                }
                out.push('\n');
            }

            // Inline / transparent containers: recurse without decoration.
            _ => self.md_children(id, out, ctx),
        }
    }

    /// Inline children, trimming surrounding whitespace (for headings, links…).
    fn md_inline(&self, id: NodeId, out: &mut String, ctx: &mut MdCtx) {
        let mut buf = String::new();
        self.md_children(id, &mut buf, ctx);
        out.push_str(buf.trim());
    }

    fn md_wrap(&self, id: NodeId, marker: &str, out: &mut String, ctx: &mut MdCtx) {
        let mut buf = String::new();
        self.md_children(id, &mut buf, ctx);
        let trimmed = buf.trim();
        if trimmed.is_empty() {
            return;
        }
        out.push_str(marker);
        out.push_str(trimmed);
        out.push_str(marker);
    }
}

/// Append text, collapsing runs of whitespace to a single space (HTML rules).
fn push_inline_text(out: &mut String, text: &str) {
    let mut last_ws = out.ends_with(|c: char| c == ' ' || c == '\n');
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !last_ws {
                out.push(' ');
                last_ws = true;
            }
        } else {
            out.push(ch);
            last_ws = false;
        }
    }
}

/// Make sure we are at the start of a fresh block (preceded by a blank line).
fn ensure_block(out: &mut String) {
    if out.is_empty() {
        return;
    }
    while out.ends_with(' ') {
        out.pop();
    }
    if !out.ends_with("\n\n") {
        if out.ends_with('\n') {
            out.push('\n');
        } else {
            out.push_str("\n\n");
        }
    }
}

/// Collapse 3+ consecutive newlines to 2 and trim leading/trailing blanks.
fn normalize_blank_lines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut newlines = 0usize;
    for ch in s.chars() {
        if ch == '\n' {
            newlines += 1;
            if newlines <= 2 {
                out.push('\n');
            }
        } else {
            newlines = 0;
            out.push(ch);
        }
    }
    out.trim().to_string()
}
