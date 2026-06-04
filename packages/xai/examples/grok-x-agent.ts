/**
 * grok-x-agent.ts
 *
 * Example: Agentic Grok + native X (zero keys, fully local).
 *
 * - Uses @aphrody/xai high-level Chat (createChat / append / sample / executeToolCalls).
 * - Grok decides when to call X tools (x_search, x_profile, x_tweets, x_news, x_whoami).
 * - Fulfillment uses native @aphrody/x XClient (cookie auth, stealth, SQLite store) via XTools.
 * - SuperGrok / gratuite via SUPER_GROK_TOKEN or ~/.grok/auth.json (no xai- key required).
 *
 * Run (after setting up X cookies + SuperGrok token):
 *   bun packages/xai/examples/grok-x-agent.ts "latest on bxc or xai on X"
 *
 * See also:
 * - packages/xai/README.md (full agent loop + XTools docs)
 * - packages/x/README.md (native X client + local For You algo)
 * - docs/PLAN.md (native X + xAI feature)
 */

import { XaiClient, user, xNativeTools, XTools } from "../src/index.ts";
import { XSession } from "../../x/src/index.ts"; // native X session (cookie-based)

async function main(query: string) {
  // 1. Native X session (cookie auth_token + ct0). Zero X API key.
  //    Use `bxc cookies ...` or XSession.loadOrEnv() from a saved session.
  const xSession = XSession.loadOrEnv();
  const xTools = new XTools(xSession); // injectable; real XClient under the hood

  // 2. Grok client (keyless SuperGrok / OIDC by default).
  const grok = new XaiClient();

  // 3. Create stateful Chat with native X tools pre-registered.
  //    Grok will emit tool_calls for x_* when it decides it needs fresh X data.
  const chat = grok.createChat("grok-3", {
    tools: xNativeTools as any, // x_search, x_profile, x_tweets, x_news, x_whoami
    // reasoning_effort: "high", // optional
  });

  chat.append(user(query || "What's the latest on bxc or the xai native client on X?"));

  // 4. Agent loop: sample → if tool_calls → execute via native XTools → append tool results → repeat.
  let res = await chat.sample();

  while (res.choices?.[0]?.message?.tool_calls?.length) {
    console.log("[grok] tool_calls:", res.choices[0].message.tool_calls.map((t: any) => t.function?.name));

    const executed = await chat.executeToolCalls({
      // Map tool names to our native XTools impls (or custom handlers).
      x_search: (args: any) => xTools.search(args),
      x_profile: (args: any) => xTools.profile(args),
      x_whoami: () => xTools.whoami(),
      x_tweets: (args: any) => xTools.tweets(args),
      x_news: (args: any) => xTools.news(args),
    });

    if (executed === 0) break;

    // Continue the conversation with tool results fed back.
    res = await chat.sample();
  }

  // 5. Final answer (Grok has fresh native X data).
  const final = res.choices?.[0]?.message?.content ?? "(no content)";
  console.log("\n[grok final]\n", final);
}

const q = process.argv.slice(2).join(" ");
main(q).catch((e) => {
  console.error("grok-x-agent error:", e);
  process.exit(1);
});
