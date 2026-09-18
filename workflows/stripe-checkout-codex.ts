// The same Stripe Checkout scenarios, run by the Codex CLI (GPT-6 Astra) through Solari's MCP
// server — stock, or our fork — and judged by the same Stripe API check.
//
//   node --env-file=.env workflows/stripe-checkout-codex.ts <stock|fast> [scenario-index=0 | all]
//
// "all" hands every scenario to one Codex session, the way one would give Codex the whole
// job; it may open as many browsers as it likes, one after another or at once.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCodex, type MCP_SERVERS } from "../lib/codex-arm.ts";
import { env } from "../lib/lane.ts";
import { goalFor, SCENARIOS, setup, verdict } from "./stripe-checkout.ts";

const mcp = (process.argv[2] ?? "stock") as keyof typeof MCP_SERVERS;
const which = process.argv[3] ?? "0";
const picked = which === "all" ? SCENARIOS : [SCENARIOS[Number(which)]!];
const { url, linkId, promo } = await setup();
const since = Math.floor(Date.now() / 1000) - 5;
const prompt = picked.length === 1
  ? [
    "Use the Solari browser tools. Create a browser session with mode 'fast' and open this Stripe checkout page:",
    url,
    `Then: ${goalFor(picked[0]!, promo)}`,
    "When finished, close the browser session and reply with one line saying whether the payment succeeded or was declined.",
  ].join("\n")
  : [
    `Use the Solari browser tools. Complete ${picked.length} separate checkouts on this Stripe checkout page, each in its own fresh browser session created with mode 'fast':`,
    url,
    ...picked.map((s, i) => `${i + 1}. ${goalFor(s, promo)}`),
    "Close each browser session when its checkout is finished. Reply with one line per checkout saying whether the payment succeeded or was declined.",
  ].join("\n");
console.log(`codex (${mcp} MCP) on ${picked.map((s) => s.name).join(", ")}…`);
const r = await runCodex({
  prompt, mcp, solariApiKey: env("SOLARI_API_KEY"), budgetMs: 60 * 60_000,
  onToolCall: (c) => console.log(`${c.atS.toFixed(1).padStart(7)}s  ${c.status.padEnd(9)} ${c.tool}`),
});
const verdicts = [];
for (const s of picked) verdicts.push({ lane: s.name, expected: s.expect, stripe_says: await verdict(linkId, s, since) });
const dir = join("runs", `stripe-codex-${mcp}-${which === "all" ? "all" : picked[0]!.name}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "run.json"), JSON.stringify({ scenarios: picked, prompt, verdicts, ...r, events: undefined }, null, 2));
console.table(verdicts.map((v) => ({ ...v, correct: v.stripe_says === v.expected ? "yes" : "NO" })));
console.log(JSON.stringify({ mcp, correct: verdicts.filter((v) => v.stripe_says === v.expected).length, of: picked.length, seconds: r.seconds, toolCalls: r.toolCalls.length, usage: r.usage, final: r.finalMessage.slice(0, 400) }, null, 2));
