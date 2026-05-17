/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Accessibility domain handler.
 *
 * Implements:
 *   Accessibility.enable          — no-op stub (always enabled in static)
 *   Accessibility.getFullAXTree   — builds full ARIA tree from static DOM
 *   Accessibility.getPartialAXTree — builds ARIA tree scoped to a nodeId subtree
 *
 * The AX tree builder operates entirely on the `ParsedDocumentLike` returned
 * by the static DOM parser (backed by zigquery or the regex fallback).  It
 * derives ARIA roles from explicit `role` attributes, then from a tag-to-role
 * mapping, and computes accessible names from aria-label / aria-labelledby /
 * associated <label> / placeholder / inner text.
 *
 * This is the critical path for `agent-browser snapshot -i` which calls
 * `Accessibility.getFullAXTree` to build a page snapshot.
 */

import { CDPError } from "../../transport/InProcessTransport.js";
import type { DomainHandler, ParsedNodeLike } from "../types.js";

// ---------------------------------------------------------------------------
// AX tree types (subset of Chrome DevTools Protocol Accessibility domain)
// ---------------------------------------------------------------------------

interface AXValue {
	type:
		| "idref"
		| "idrefList"
		| "integer"
		| "node"
		| "nodeList"
		| "number"
		| "string"
		| "computedString"
		| "token"
		| "tokenList"
		| "domRelation"
		| "role"
		| "internalRole"
		| "valueUndefined"
		| "boolean"
		| "tristate";
	value?: unknown;
	relatedNodes?: Array<{ backendDOMNodeId: number }>;
}

interface AXProperty {
	name: string;
	value: AXValue;
}

interface AXNode {
	nodeId: string;
	ignored: boolean;
	ignoredReasons?: AXValue[];
	role?: AXValue;
	name?: AXValue;
	description?: AXValue;
	value?: AXValue;
	properties?: AXProperty[];
	parentId?: string;
	childIds?: string[];
	backendDOMNodeId?: number;
	frameId?: string;
}

// ---------------------------------------------------------------------------
// Tag-to-ARIA-role mapping (WAI-ARIA 1.2 + HTML-AAM)
// ---------------------------------------------------------------------------

const TAG_ROLE_MAP: Record<string, string> = {
	a: "link",
	area: "link",
	article: "article",
	aside: "complementary",
	button: "button",
	caption: "caption",
	code: "code",
	datalist: "listbox",
	dd: "definition",
	del: "deletion",
	details: "group",
	dfn: "term",
	dialog: "dialog",
	dt: "term",
	em: "emphasis",
	fieldset: "group",
	figure: "figure",
	footer: "contentinfo",
	form: "form",
	h1: "heading",
	h2: "heading",
	h3: "heading",
	h4: "heading",
	h5: "heading",
	h6: "heading",
	header: "banner",
	hr: "separator",
	html: "document",
	img: "img",
	ins: "insertion",
	li: "listitem",
	link: "link",
	main: "main",
	mark: "mark",
	math: "math",
	menu: "list",
	meter: "meter",
	nav: "navigation",
	ol: "list",
	optgroup: "group",
	option: "option",
	output: "status",
	p: "paragraph",
	pre: "generic",
	progress: "progressbar",
	q: "generic",
	s: "deletion",
	samp: "generic",
	search: "search",
	section: "region",
	select: "listbox",
	strong: "strong",
	sub: "subscript",
	summary: "button",
	sup: "superscript",
	svg: "graphics-document",
	table: "table",
	tbody: "rowgroup",
	td: "cell",
	textarea: "textbox",
	tfoot: "rowgroup",
	th: "columnheader",
	thead: "rowgroup",
	time: "time",
	tr: "row",
	track: "none",
	ul: "list",
	var: "generic",
	video: "none",
};

/**
 * Returns the ARIA role for an input element based on its type attribute.
 */
function inputRole(type: string): string {
	switch (type.toLowerCase()) {
		case "button":
		case "image":
		case "reset":
		case "submit":
			return "button";
		case "checkbox":
			return "checkbox";
		case "radio":
			return "radio";
		case "range":
			return "slider";
		case "number":
			return "spinbutton";
		case "search":
			return "searchbox";
		case "hidden":
			return "none";
		default:
			// text, email, url, tel, password, date, time, etc.
			return "textbox";
	}
}

/**
 * Derives the semantic ARIA role from a parsed DOM node.
 * Explicit `role` attribute takes precedence over tag-based mapping.
 */
function deriveRole(node: ParsedNodeLike): string {
	const explicitRole = node.attributes["role"];
	if (explicitRole && explicitRole.trim()) return explicitRole.trim().split(/\s+/)[0];

	const tag = node.tagName.toLowerCase();

	if (tag === "input") {
		return inputRole(node.attributes["type"] ?? "text");
	}

	return TAG_ROLE_MAP[tag] ?? "generic";
}

/**
 * Returns the heading level (1-6) for heading nodes, or 0 for non-headings.
 */
function headingLevel(tagName: string): number {
	const m = /^h([1-6])$/.exec(tagName.toLowerCase());
	return m ? parseInt(m[1], 10) : 0;
}

/**
 * Determines whether a node should be excluded from the AX tree.
 * Nodes that are purely presentational or have role="none"/"presentation"
 * are ignored.  Hidden elements (display:none / aria-hidden=true) are marked
 * ignored but still emitted so agents can detect them.
 */
function isIgnored(node: ParsedNodeLike): boolean {
	const role = node.attributes["role"] ?? "";
	if (role === "none" || role === "presentation") return true;

	// Non-semantic / metadata tags that carry no AX meaning.
	const tag = node.tagName.toLowerCase();
	if (["script", "style", "meta", "link", "noscript", "template"].includes(tag)) return true;

	// hidden input elements: the element itself is ignored.
	if (tag === "input" && (node.attributes["type"] ?? "text").toLowerCase() === "hidden") {
		// Only ignore the input node if there is no aria-label override.
		if (!node.attributes["aria-label"]) return true;
	}

	return false;
}

/**
 * Checks if a node is visually/programmatically hidden.
 * This sets `ignored=true` with a reason, but the node is still returned.
 */
function isHidden(node: ParsedNodeLike): boolean {
	if (node.attributes["aria-hidden"] === "true") return true;
	const style = node.attributes["style"] ?? "";
	if (/display\s*:\s*none/i.test(style)) return true;
	if (/visibility\s*:\s*hidden/i.test(style)) return true;
	return false;
}

/**
 * Normalises whitespace and trims a candidate accessible name string.
 */
function normText(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/**
 * Extracts a trimmed inner-text approximation from an outerHTML string.
 * Strips HTML tags and collapses whitespace.
 */
function innerTextFromHtml(html: string): string {
	return normText(html.replace(/<[^>]+>/g, " "));
}

/**
 * Computes the accessible name for a node using the ACC Name algorithm
 * (simplified for a static DOM without full label resolution).
 *
 * Priority order (ARIA spec §4.3.1):
 *   1. aria-labelledby (resolved to text of referenced element)
 *   2. aria-label
 *   3. native label (<label for=id> or wrapping label)
 *   4. placeholder (input/textarea)
 *   5. alt (img)
 *   6. title attribute
 *   7. inner text / text content
 */
function computeName(node: ParsedNodeLike, allNodes: ParsedNodeLike[]): string {
	// 1. aria-labelledby: list of idrefs pointing to other elements.
	const labelledBy = node.attributes["aria-labelledby"];
	if (labelledBy) {
		const ids = labelledBy.trim().split(/\s+/);
		const parts: string[] = [];
		for (const id of ids) {
			const target = allNodes.find((n) => n.attributes["id"] === id);
			if (target) parts.push(normText(target.textContent));
		}
		if (parts.length) return parts.join(" ");
	}

	// 2. aria-label
	const ariaLabel = node.attributes["aria-label"];
	if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

	// 3. <label for=id> association
	const nodeId = node.attributes["id"];
	if (nodeId) {
		const label = allNodes.find(
			(n) => n.tagName.toLowerCase() === "label" && n.attributes["for"] === nodeId,
		);
		if (label) {
			const t = normText(label.textContent);
			if (t) return t;
		}
	}

	// 4. placeholder
	const placeholder = node.attributes["placeholder"];
	if (placeholder && placeholder.trim()) return placeholder.trim();

	// 5. alt (for img)
	const alt = node.attributes["alt"];
	if (alt !== undefined) return alt.trim();

	// 6. title
	const title = node.attributes["title"];
	if (title && title.trim()) return title.trim();

	// 7. inner text content
	const text = normText(node.textContent || innerTextFromHtml(node.outerHTML));
	return text;
}

/**
 * Builds an AXNode from a parsed DOM node.
 * Returns null for fully ignored nodes that should be omitted.
 */
function buildAXNode(
	node: ParsedNodeLike,
	axId: string,
	parentAxId: string | undefined,
	childAxIds: string[],
	allNodes: ParsedNodeLike[],
): AXNode {
	const ignored = isIgnored(node) || isHidden(node);
	const role = deriveRole(node);
	const name = computeName(node, allNodes);

	const axNode: AXNode = {
		nodeId: axId,
		ignored,
		role: { type: "role", value: role },
		name: name ? { type: "computedString", value: name } : undefined,
		childIds: childAxIds,
		backendDOMNodeId: node.nodeId,
	};

	if (parentAxId !== undefined) {
		axNode.parentId = parentAxId;
	}

	// Build properties array.
	const properties: AXProperty[] = [];

	// level for headings.
	const level = headingLevel(node.tagName);
	if (level > 0) {
		properties.push({ name: "level", value: { type: "integer", value: level } });
	}

	// checked state for checkboxes / radios.
	if (role === "checkbox" || role === "radio") {
		const ariaChecked = node.attributes["aria-checked"];
		if (ariaChecked === "mixed") {
			properties.push({ name: "checked", value: { type: "tristate", value: "mixed" } });
		} else {
			const checked = "checked" in node.attributes || ariaChecked === "true";
			properties.push({ name: "checked", value: { type: "boolean", value: checked } });
		}
	}

	// disabled state.
	const disabled = "disabled" in node.attributes || node.attributes["aria-disabled"] === "true";
	if (disabled) {
		properties.push({ name: "disabled", value: { type: "boolean", value: true } });
	}

	// required state.
	const required = "required" in node.attributes || node.attributes["aria-required"] === "true";
	if (required) {
		properties.push({ name: "required", value: { type: "boolean", value: true } });
	}

	// expanded state for disclosure widgets.
	const ariaExpanded = node.attributes["aria-expanded"];
	if (ariaExpanded !== undefined) {
		properties.push({
			name: "expanded",
			value: { type: "boolean", value: ariaExpanded === "true" },
		});
	}

	// focused (aria-activedescendant indirectly, but we mark aria-focused).
	if (node.attributes["autofocus"] !== undefined) {
		properties.push({ name: "focused", value: { type: "boolean", value: true } });
	}

	// hidden (aria-hidden attribute).
	if (node.attributes["aria-hidden"] === "true") {
		properties.push({ name: "hidden", value: { type: "boolean", value: true } });
	}

	// selected (for option, tab, etc.).
	if (node.attributes["aria-selected"] !== undefined) {
		properties.push({
			name: "selected",
			value: { type: "boolean", value: node.attributes["aria-selected"] === "true" },
		});
	}

	// value for range/spinbutton.
	if (role === "slider" || role === "spinbutton" || role === "scrollbar") {
		const val = node.attributes["aria-valuenow"] ?? node.attributes["value"];
		if (val !== undefined) {
			properties.push({
				name: "value",
				value: { type: "number", value: parseFloat(val) || 0 },
			});
		}
	}

	if (properties.length > 0) {
		axNode.properties = properties;
	}

	// Ignored reasons.
	if (ignored) {
		const reasons: AXValue[] = [];
		if (isHidden(node)) {
			reasons.push({ type: "string", value: "ariaHiddenElement" });
		}
		const roleStr = node.attributes["role"] ?? "";
		if (roleStr === "none" || roleStr === "presentation") {
			reasons.push({ type: "string", value: "presentationalRole" });
		}
		const tag = node.tagName.toLowerCase();
		if (["script", "style", "meta", "link", "noscript", "template"].includes(tag)) {
			reasons.push({ type: "string", value: "notRendered" });
		}
		if (reasons.length) axNode.ignoredReasons = reasons;
	}

	return axNode;
}

/**
 * Parses the HTML in a ParsedDocumentLike into an ordered list of flat nodes
 * using CSS queries to enumerate all elements.
 *
 * Note: ParsedDocumentLike does not expose a tree traversal API so we use
 * querySelectorAll("*") for enumeration and reconstruct parent-child
 * relationships via a flat index.
 */
async function buildAXTree(
	doc: {
		rawHtml: string;
		querySelectorAll(sel: string): Promise<ParsedNodeLike[]>;
		querySelector(sel: string): Promise<ParsedNodeLike | undefined>;
		getNodeById(id: number): ParsedNodeLike | undefined;
		rootId: number;
	},
	scopeNodeId?: number,
): Promise<AXNode[]> {
	const allNodes = await doc.querySelectorAll("*");
	if (allNodes.length === 0) return [];

	// 1. Reconstruct the tree structure from rawHtml using a stack.
	// Since allNodes are in document order, we can match them back to the tags.
	const parentMap = new Map<number, number>(); // childId -> parentId
	const stack: Array<{ nodeId: number; tagName: string }> = [];
	
	// We use a simplified tag scanner to match nodes in allNodes.
	const TAG_RE = /<(\/?[a-zA-Z][a-zA-Z0-9-]*)/g;
	let nodeIdx = 0;
	let match: RegExpExecArray | null;

	while ((match = TAG_RE.exec(doc.rawHtml)) !== null) {
		const fullTag = match[1];
		if (fullTag.startsWith("/")) {
			// Closing tag - pop from stack if it matches.
			const tagName = fullTag.slice(1).toLowerCase();
			// Pop until we find the matching opening tag (handling unclosed tags gracefully).
			while (stack.length > 0 && stack[stack.length - 1].tagName !== tagName) {
				stack.pop();
			}
			stack.pop();
		} else {
			// Opening tag.
			const tagName = fullTag.toLowerCase();
			const isSelfClosing = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(tagName);
			
			// Match this tag to the next node in allNodes.
			// (querySelectorAll might skip some tags like <head> depending on implementation,
			// but zigquery is usually consistent).
			if (nodeIdx < allNodes.length && allNodes[nodeIdx].tagName.toLowerCase() === tagName) {
				const currentNode = allNodes[nodeIdx];
				if (stack.length > 0) {
					parentMap.set(currentNode.nodeId, stack[stack.length - 1].nodeId);
				}
				if (!isSelfClosing) {
					stack.push({ nodeId: currentNode.nodeId, tagName });
				}
				nodeIdx++;
			} else if (!isSelfClosing) {
				// Node not in allNodes (e.g. text or comment), but still push to stack to maintain depth.
				stack.push({ nodeId: -1, tagName });
			}
		}
	}

	// 2. Identify target nodes for partial tree.
	let targetNodeIds: Set<number> | null = null;
	if (scopeNodeId !== undefined) {
		targetNodeIds = new Set<number>();
		
		// Find the scope node (handle ID stability).
		let rootId = scopeNodeId;
		if (!allNodes.some(n => n.nodeId === scopeNodeId)) {
			const scopeNode = doc.getNodeById(scopeNodeId);
			if (scopeNode) {
				const match = allNodes.find(n => n.outerHTML === scopeNode.outerHTML);
				if (match) rootId = match.nodeId;
			}
		}

		targetNodeIds.add(rootId);
		
		// Multi-pass to find all descendants.
		let added = true;
		while (added) {
			added = false;
			for (const [childId, parentId] of parentMap) {
				if (targetNodeIds.has(parentId) && !targetNodeIds.has(childId)) {
					targetNodeIds.add(childId);
					added = true;
				}
			}
		}
	}

	// 3. Filter and build.
	const filteredNodes = targetNodeIds 
		? allNodes.filter(n => targetNodeIds!.has(n.nodeId))
		: allNodes;
	
	const filteredIds = new Set(filteredNodes.map(n => n.nodeId));
	const childrenMap = new Map<number, number[]>();
	for (const [childId, parentId] of parentMap) {
		if (filteredIds.has(childId) && filteredIds.has(parentId)) {
			const list = childrenMap.get(parentId) ?? [];
			list.push(childId);
			childrenMap.set(parentId, list);
		}
	}

	const axIdMap = new Map<number, string>();
	filteredNodes.forEach((n, i) => axIdMap.set(n.nodeId, String(i + 1)));

	const axNodes: AXNode[] = [];
	for (const node of filteredNodes) {
		const axId = axIdMap.get(node.nodeId)!;
		const parentId = parentMap.get(node.nodeId);
		const parentAxId = (parentId !== undefined && filteredIds.has(parentId)) ? axIdMap.get(parentId) : undefined;
		const childAxIds = (childrenMap.get(node.nodeId) ?? []).map(id => axIdMap.get(id)!).filter(Boolean);

		axNodes.push(buildAXNode(node, axId, parentAxId, childAxIds, allNodes));
	}

	return axNodes;
}

// ---------------------------------------------------------------------------
// AX tree LRU cache
//
// Caches the full AX tree per (sessionId, loaderId) pair.
// The loaderId changes on every Page.navigate / Page.reload, so the cached
// entry is implicitly invalidated the moment a new navigation occurs.
//
// Max capacity is 64 entries (covers typical multi-tab sessions).
// When the cap is reached, the oldest entry (first inserted) is evicted.
// ---------------------------------------------------------------------------

const AX_CACHE_MAX = 64;

interface AXCacheEntry {
	tree: AXNode[];
	loaderId: string;
}

/**
 * Stable cache key: "<sessionId>|<loaderId>".
 * We embed the loaderId in the key so a lookup against a stale loaderId
 * automatically misses — no explicit eviction needed on navigation.
 */
const axCache = new Map<string, AXCacheEntry>();

/**
 * Returns the cached AX tree if the session's current loaderId matches.
 * Returns undefined on cache miss.
 */
function axCacheGet(sessionId: string, loaderId: string): AXNode[] | undefined {
	const key = `${sessionId}|${loaderId}`;
	return axCache.get(key)?.tree;
}

/**
 * Stores an AX tree in the cache.
 * Evicts the oldest entry when the cap is exceeded.
 * Also clears any stale entries for the same sessionId (different loaderId).
 */
function axCacheSet(sessionId: string, loaderId: string, tree: AXNode[]): void {
	// Remove stale entries for this sessionId (different loaderId).
	// This keeps the Map lean between navigations.
	for (const key of axCache.keys()) {
		if (key.startsWith(`${sessionId}|`) && key !== `${sessionId}|${loaderId}`) {
			axCache.delete(key);
		}
	}

	// Enforce max capacity (FIFO eviction via Map insertion order).
	if (axCache.size >= AX_CACHE_MAX) {
		const firstKey = axCache.keys().next().value;
		if (firstKey !== undefined) axCache.delete(firstKey);
	}

	axCache.set(`${sessionId}|${loaderId}`, { tree, loaderId });
}

/**
 * Invalidates all cached AX trees for a given sessionId.
 * Call this when a navigation starts so that the next getFullAXTree
 * call always sees the freshly-parsed document.
 */
export function invalidateAXCache(sessionId: string): void {
	for (const key of axCache.keys()) {
		if (key.startsWith(`${sessionId}|`)) {
			axCache.delete(key);
		}
	}
}

// ---------------------------------------------------------------------------
// Domain handler
// ---------------------------------------------------------------------------

export const AccessibilityHandler: DomainHandler = async (method, params, ctx, sessionId) => {
	switch (method) {
		// -------------------------------------------------------------------
		// Accessibility.enable — no-op in static profile
		// -------------------------------------------------------------------
		case "Accessibility.enable": {
			return {};
		}

		// -------------------------------------------------------------------
		// Accessibility.getFullAXTree
		//
		// Cache strategy: keyed by (sessionId, loaderId).
		// - Cache HIT  : target <0.5 ms (Map lookup + return reference).
		// - Cache MISS : build AX tree from doc, store in cache.
		// The loaderId is set by Page.navigate / Page.reload; a new loaderId
		// means a new document, so the previous cache entry is automatically
		// superseded on the next call.
		// -------------------------------------------------------------------
		case "Accessibility.getFullAXTree": {
			const page = ctx.pageBySession(sessionId);
			if (!page.doc) {
				// No document loaded yet — return empty tree.
				return { nodes: [] };
			}

			const sid = sessionId ?? "";
			const cached = axCacheGet(sid, page.loaderId);
			if (cached !== undefined) {
				return { nodes: cached };
			}

			const nodes = await buildAXTree(page.doc);
			axCacheSet(sid, page.loaderId, nodes);
			return { nodes };
		}

		// -------------------------------------------------------------------
		// Accessibility.getPartialAXTree
		// -------------------------------------------------------------------
		case "Accessibility.getPartialAXTree": {
			const { nodeId, backendNodeId } = params as {
				nodeId?: number;
				backendNodeId?: number;
				fetchRelatives?: boolean;
			};
			const page = ctx.pageBySession(sessionId);
			if (!page.doc) {
				throw new CDPError("No document loaded", -32000);
			}

			const id = nodeId ?? backendNodeId;
			if (id === undefined) {
				throw new CDPError("nodeId or backendNodeId required", -32602);
			}

			const scopeNode = page.doc.getNodeById(id);
			if (!scopeNode) {
				throw new CDPError(`Node not found: ${id}`, -32602);
			}

			const nodes = await buildAXTree(page.doc, id);
			return { nodes };
		}

		default:
			return null;
	}
};
