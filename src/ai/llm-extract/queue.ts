// Serial queue : 1 task at a time. Gemma-on-CPU is memory-bandwidth bound,
// concurrency does NOT increase throughput, only fights for the same DRAM channels.
// Use this around all calls to LlmClient when scraping at scale.

export class SerialQueue {
	private chain: Promise<void> = Promise.resolve();
	private depth = 0;

	enqueue<T>(task: () => Promise<T>): Promise<T> {
		this.depth++;
		const result = this.chain.then(task);
		// Keep the chain alive even if a task rejects — otherwise one fail
		// poisons every subsequent enqueue with an unhandled rejection.
		this.chain = result.then(
			() => {
				this.depth--;
			},
			() => {
				this.depth--;
			},
		);
		return result;
	}

	get pending(): number {
		return this.depth;
	}
}

// Convenience singleton — most apps want one queue per llama-server instance.
export const globalLlmQueue = new SerialQueue();
