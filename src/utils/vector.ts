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
 * Projects text into a 512-dimensional unit-length term vector (Hashing Trick).
 * This FNV-1a inspired hash-projection algorithm runs natively in Bun without requiring
 * external network calls or LLM API keys.
 */
export function getLocalTextEmbedding(text: string, dimensions = 512): number[] {
	const clean = text.replace(/[^\w\s]/g, " ").toLowerCase();
	const words = clean.split(/\s+/).filter(Boolean);
	const vector = new Array(dimensions).fill(0);

	for (const word of words) {
		// FNV-1a 32-bit hash
		let hash = 2166136261;
		for (let i = 0; i < word.length; i++) {
			hash ^= word.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		
		const index = Math.abs(hash) % dimensions;
		// Determine polarity to avoid bias accumulation
		const polarity = (hash & 1) === 0 ? 1 : -1;
		vector[index] += polarity;
	}

	// Normalize vector to L2 unit length
	const sumOfSquares = vector.reduce((sum, val) => sum + val * val, 0);
	const magnitude = Math.sqrt(sumOfSquares);
	if (magnitude === 0) return vector;

	return vector.map((val) => val / magnitude);
}

/**
 * Generate text embedding.
 * Automatically detects GEMINI_API_KEY or OPENAI_API_KEY, falling back to local feature hashing.
 */
export async function getEmbedding(text: string): Promise<number[]> {
	const cleanText = text.slice(0, 10000); // Truncate to limit tokens

	if (process.env.GEMINI_API_KEY) {
		try {
			const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					content: { parts: [{ text: cleanText }] }
				})
			});
			if (res.ok) {
				const json = await res.json() as any;
				if (json.embedding?.values) {
					return json.embedding.values;
				}
			}
		} catch (err) {
			console.error("[vector-embedding] Gemini embedContent request failed:", err);
		}
	}

	if (process.env.OPENAI_API_KEY) {
		try {
			const res = await fetch("https://api.openai.com/v1/embeddings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
				},
				body: JSON.stringify({
					model: "text-embedding-3-small",
					input: cleanText
				})
			});
			if (res.ok) {
				const json = await res.json() as any;
				if (json.data?.[0]?.embedding) {
					return json.data[0].embedding;
				}
			}
		} catch (err) {
			console.error("[vector-embedding] OpenAI embeddings request failed:", err);
		}
	}

	// High-speed local hash-projection fallback
	return getLocalTextEmbedding(cleanText);
}

/**
 * Calculates the cosine similarity score between two float vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;
	let dotProduct = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const valA = a[i];
		const valB = b[i];
		dotProduct += valA * valB;
		normA += valA * valA;
		normB += valB * valB;
	}
	if (normA === 0 || normB === 0) return 0;
	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
