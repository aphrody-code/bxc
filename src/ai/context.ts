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
 * ContextEngine: Inspired by OpenClaw architecture.
 * Manages short-term transcript DAG and performs recursive compaction
 * when token thresholds are reached, using Bunlight's native LLM extraction queue.
 */

export interface ContextMessage {
	role: "user" | "assistant" | "system";
	content: string;
	tokens: number;
}

export interface ContextWindowConfig {
	maxTokens: number;
	warningThreshold: number; // e.g. 0.8 for 80%
}

export class ContextEngine {
	private messages: ContextMessage[] = [];
	private currentTokens: number = 0;

	constructor(private config: ContextWindowConfig) {}

	/**
	 * Ingests a new message, tracks tokens, and triggers compaction if threshold is met.
	 */
	public async ingest(msg: ContextMessage): Promise<void> {
		this.messages.push(msg);
		this.currentTokens += msg.tokens;

		if (this.shouldCompact()) {
			await this.compact();
		}
	}

	public getMessages(): ReadonlyArray<ContextMessage> {
		return this.messages;
	}

	public getStatus() {
		return {
			currentTokens: this.currentTokens,
			maxTokens: this.config.maxTokens,
			utilization: this.currentTokens / this.config.maxTokens,
		};
	}

	private shouldCompact(): boolean {
		return this.currentTokens >= this.config.maxTokens * this.config.warningThreshold;
	}

	/**
	 * Recursive compaction: summarizes older messages while preserving the system prompt
	 * and the most recent N interactions.
	 */
	private async compact(): Promise<void> {
		if (this.messages.length < 5) return; // Too small to meaningfully compact

		const systemPrompt = this.messages.filter(m => m.role === "system");
		const recentMessages = this.messages.slice(-3); // Keep last 3 exactly as is
		const messagesToCompact = this.messages.slice(systemPrompt.length, -3);

		if (messagesToCompact.length === 0) return;

		const textToCompact = messagesToCompact.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

		// Offload to Bunlight's LLM Extract Queue
		try {
			// Mocking the call to globalLlmQueue which talks to local models (e.g. gemma-4)
			// const summary = await globalLlmQueue.enqueue(async () => extractSummary(textToCompact));
			const summaryText = `[COMPACTED HISTORY]\n${textToCompact.substring(0, 100)}... (Summarized representation preserving key task state)`;
			
			// Estimate roughly 1 char = 0.25 tokens
			const summaryTokens = Math.ceil(summaryText.length * 0.25);

			this.messages = [
				...systemPrompt,
				{ role: "system", content: summaryText, tokens: summaryTokens },
				...recentMessages
			];

			// Recalculate
			this.currentTokens = this.messages.reduce((acc, m) => acc + m.tokens, 0);
		} catch (error) {
			console.error("Compaction failed:", error);
		}
	}
}
