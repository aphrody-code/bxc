import { runPythonNative } from "./uv-bridge.ts";

export interface RagContent {
	title: string;
	markdown: string;
	text_length: number;
}

export async function cleanHtmlForRag(html: string): Promise<RagContent> {
	const res = await runPythonNative<RagContent>("rag_manager", "clean_html_for_rag", [html]);
	if (res.status === "error") {
		throw new Error(`RAG cleaning failed: ${res.error}`);
	}
	return res.data!;
}

// No-op for native mode
export function shutdownRag() {}
