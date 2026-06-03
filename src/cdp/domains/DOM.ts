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
 * DOM domain handler.
 *
 * Handles: DOM.getDocument, DOM.querySelector, DOM.querySelectorAll,
 *          DOM.getOuterHTML, DOM.describeNode,
 *          DOM.enable, DOM.getBoxModel, DOM.resolveNode, DOM.setFileInputFiles
 */

import { CDPError } from "../../transport/InProcessTransport.ts";
import type { DomainHandler } from "../types.ts";

/**
 * Tries to parse a CSS dimension (e.g. "300px", "10.5em") and return the
 * numeric part.  Returns 0 when parsing fails or the unit is not recognized.
 */
function parseCssDimension(value: string): number {
	const m = /^(-?\d+(?:\.\d+)?)(px|em|rem|vw|vh|%|pt|cm|mm)?$/.exec(
		value.trim(),
	);
	if (!m) return 0;
	// Only px values are directly useful without layout; others default 0.
	if (!m[2] || m[2] === "px") return parseFloat(m[1] ?? "0");
	return 0;
}

/**
 * Extracts a rough bounding box from inline style or width/height attributes.
 * Returns { x, y, width, height } — all 0 when no layout info is available.
 */
function extractBoxFromNode(attrs: Record<string, string>): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	let x = 0;
	let y = 0;
	let width = 0;
	let height = 0;

	// Attempt to read from inline `style` attribute.
	const style = attrs["style"] ?? "";
	if (style) {
		const wm = /(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(style);
		if (wm) width = parseCssDimension(wm[1] ?? "");
		const hm = /(?:^|;)\s*height\s*:\s*([^;]+)/i.exec(style);
		if (hm) height = parseCssDimension(hm[1] ?? "");
		const lm = /(?:^|;)\s*(?:left|margin-left)\s*:\s*([^;]+)/i.exec(style);
		if (lm) x = parseCssDimension(lm[1] ?? "");
		const tm = /(?:^|;)\s*(?:top|margin-top)\s*:\s*([^;]+)/i.exec(style);
		if (tm) y = parseCssDimension(tm[1] ?? "");
	}

	// Fallback: HTML attributes.
	if (width === 0 && attrs["width"]) width = parseCssDimension(attrs["width"]);
	if (height === 0 && attrs["height"])
		height = parseCssDimension(attrs["height"]);

	return { x, y, width, height };
}

export const DOMHandler: DomainHandler = async (
	method,
	params,
	ctx,
	sessionId,
) => {
	switch (method) {
		case "DOM.getDocument": {
			const page = ctx.pageBySession(sessionId);
			if (!page.doc) {
				return {
					root: {
						nodeId: 1,
						backendNodeId: 1,
						nodeType: 9,
						nodeName: "#document",
						localName: "",
						nodeValue: "",
						childNodeCount: 0,
						documentURL: page.url,
						baseURL: page.url,
						frameId: page.frameId,
					},
				};
			}
			const root = page.doc.toCDPNode(page.doc.getNodeById(page.doc.rootId)!);
			root.documentURL = page.url;
			root.baseURL = page.url;
			root.frameId = page.frameId;
			return { root };
		}

		case "DOM.querySelector": {
			const { nodeId: _nodeId, selector } = params as {
				nodeId: number;
				selector: string;
			};
			const page = ctx.pageBySession(sessionId);
			if (!page.doc) return { nodeId: 0 };
			const node = await page.doc.querySelector(selector);
			return { nodeId: node?.nodeId ?? 0 };
		}

		case "DOM.querySelectorAll": {
			const { nodeId: _nodeId, selector } = params as {
				nodeId: number;
				selector: string;
			};
			const page = ctx.pageBySession(sessionId);
			if (!page.doc) return { nodeIds: [] };
			const nodes = await page.doc.querySelectorAll(selector);
			return { nodeIds: nodes.map((n) => n.nodeId) };
		}

		case "DOM.getOuterHTML": {
			const { nodeId } = params as { nodeId?: number; backendNodeId?: number };
			const page = ctx.pageBySession(sessionId);
			if (!page.doc) return { outerHTML: "" };
			if (!nodeId) return { outerHTML: page.doc.rawHtml };
			const node = page.doc.getNodeById(nodeId);
			return { outerHTML: node?.outerHTML ?? "" };
		}

		case "DOM.describeNode": {
			const { nodeId } = params as { nodeId: number };
			const page = ctx.pageBySession(sessionId);
			if (!page.doc) throw new CDPError("No document loaded", -32000);
			const node = page.doc.getNodeById(nodeId);
			if (!node) throw new CDPError(`Node not found: ${nodeId}`, -32602);
			return { node: page.doc.toCDPNode(node) };
		}

		// -----------------------------------------------------------------------
		// New in Phase 1: DOM.enable
		// -----------------------------------------------------------------------
		case "DOM.enable": {
			// Static mode: no-op stub (DOM is always "enabled").
			return {};
		}

		// -----------------------------------------------------------------------
		// New in Phase 1: DOM.getBoxModel
		// -----------------------------------------------------------------------
		case "DOM.getBoxModel": {
			const { nodeId, backendNodeId } = params as {
				nodeId?: number;
				backendNodeId?: number;
			};
			const page = ctx.pageBySession(sessionId);
			if (!page.doc) throw new CDPError("No document loaded", -32000);

			const id = nodeId ?? backendNodeId;
			if (!id) throw new CDPError("nodeId or backendNodeId required", -32602);

			const node = page.doc.getNodeById(id);
			if (!node) throw new CDPError(`Node not found: ${id}`, -32602);

			const { x, y, width, height } = extractBoxFromNode(node.attributes);

			// CDP BoxModel: content/padding/border/margin quads are 8-element arrays
			// representing the 4 corners of the box [x1,y1, x2,y1, x2,y2, x1,y2].
			const quad = [x, y, x + width, y, x + width, y + height, x, y + height];

			return {
				model: {
					content: quad,
					padding: quad,
					border: quad,
					margin: quad,
					width,
					height,
				},
			};
		}

		// -----------------------------------------------------------------------
		// New in Phase 1: DOM.resolveNode
		// -----------------------------------------------------------------------
		case "DOM.resolveNode": {
			const { nodeId, backendNodeId, objectGroup } = params as {
				nodeId?: number;
				backendNodeId?: number;
				objectGroup?: string;
			};
			const page = ctx.pageBySession(sessionId);
			if (!page.doc) throw new CDPError("No document loaded", -32000);

			const id = nodeId ?? backendNodeId;
			if (!id) throw new CDPError("nodeId or backendNodeId required", -32602);

			const node = page.doc.getNodeById(id);
			if (!node) throw new CDPError(`Node not found: ${id}`, -32602);

			// Construct a synthetic Runtime.RemoteObject representing this DOM node.
			// objectId encodes the nodeId so Runtime.callFunctionOn can look it up.
			const objectId = JSON.stringify({
				injectedScriptId: 1,
				id,
				group: objectGroup ?? "default",
			});

			return {
				object: {
					type: "object",
					subtype: "node",
					className:
						node.tagName === "#document" ? "HTMLDocument" : "HTMLElement",
					description:
						node.tagName === "#document"
							? "#document"
							: node.tagName.toLowerCase(),
					objectId,
				},
			};
		}

		// -----------------------------------------------------------------------
		// New in Phase 1: DOM.setFileInputFiles
		// -----------------------------------------------------------------------
		case "DOM.setFileInputFiles": {
			// Static mode has no JS execution — file input manipulation is not possible.
			throw new CDPError(
				"DOM.setFileInputFiles: no JS execution in static profile",
				-32000,
			);
		}

		default:
			return null;
	}
};
