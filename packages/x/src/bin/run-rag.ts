// SPDX-License-Identifier: Apache-2.0
import { Store } from "../db/store";
import { BeybladeXRag } from "../services/rag";

async function main() {
  const args = process.argv.slice(2);
  let queryIndex = args.indexOf("--query");
  if (queryIndex === -1) {
    queryIndex = args.indexOf("-q");
  }

  const query = queryIndex !== -1 && args[queryIndex + 1] ? args[queryIndex + 1] : "";
  if (!query) {
    console.error("Usage: bun run src/bin/run-rag.ts --query <your query>");
    process.exit(1);
  }

  const store = new Store();
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    console.warn("⚠️  GEMINI_API_KEY or GOOGLE_API_KEY is not set in environment. Running in offline mock mode.");
  }

  const rag = new BeybladeXRag({
    apiKey,
    model: "gemini-2.5-flash"
  });

  console.log(`\n🔍 Querying RAG System for: "${query}"...`);
  const result = await rag.query(query, store);

  console.log(`\n=================== RAG ANSWER ===================\n`);
  console.log(result.answer);
  console.log(`\n==================================================\n`);

  console.log(`\n📚 Cited Sources (${result.sources.length} total):`);
  for (const s of result.sources.slice(0, 5)) {
    console.log(`- [@${s.author_username}] (Likes: ${s.like_count}): "${s.text.replace(/\n/g, " ").slice(0, 80)}..."`);
  }
  if (result.sources.length > 5) {
    console.log(`- and ${result.sources.length - 5} more sources...`);
  }

  store.close();
}

main().catch(console.error);
