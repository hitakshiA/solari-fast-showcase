// The same Stripe Checkout scenarios, run by the Codex CLI (GPT-6 Astra) through Solari's MCP
// server — stock, or our fork — and judged by the same Stripe API check.
//
//   node --env-file=.env workflows/stripe-checkout-codex.ts <stock|fast> [scenario-index=0]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCodex, type MCP_SERVERS } from "../lib/codex-arm.ts";
import { env } from "../lib/lane.ts";
import { goalFor, SCENARIOS, setup, verdict } from "./stripe-checkout.ts";

const mcp = (process.argv[2] ?? "stock") as keyof typeof MCP_SERVERS;
const s = SCENARIOS[Number(process.argv[3] ?? 0)]!;
const { url, linkId, promo } = await setup();
const since = Math.floor(Date.now() / 1000) - 5;
const prompt = [
  "Use the Solari browser tools. Create a browser session with mode 'fast' and open this Stripe checkout page:",
  url,
  `Then: ${goalFor(s, promo)}`,
  "When finished, close the browser session and reply with one line saying whether the payment succeeded or was declined.",
].join("\n");
console.log(`codex (${mcp} MCP) on ${s.name}…`);
const r = await runCodex({
  prompt, mcp, solariApiKey: env("SOLARI_API_KEY"), budgetMs: 45 * 60_000,
  onToolCall: (c) => console.log(`${c.atS.toFixed(1).padStart(7)}s  ${c.status.padEnd(9)} ${c.tool}`),
});
const v = await verdict(linkId, s, since);
const dir = join("runs", `stripe-codex-${mcp}-${s.name}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "run.json"), JSON.stringify({ scenario: s, prompt, verdict: v, ...r, events: undefined }, null, 2));
console.log(JSON.stringify({ lane: s.name, mcp, expected: s.expect, stripe_says: v, correct: v === s.expect, seconds: r.seconds, toolCalls: r.toolCalls.length, usage: r.usage, final: r.finalMessage.slice(0, 200) }, null, 2));
