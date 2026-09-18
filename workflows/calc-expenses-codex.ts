// The same Calc expense sheet, filled by the Codex CLI (GPT-6 Astra) through Solari's MCP
// server, either stock or our fork, and checked against the same answer key.
//
// Codex gets the desktop with the sheet already open, and must work through Calc's UI like
// the Jev arm does. Any call to a shell or file tool breaks that rule, so the run is marked
// as a violation, whatever the file ends up containing.
//
//   node --env-file=.env workflows/calc-expenses-codex.ts <stock|fast> [rows=30]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DesktopSurface, Solari } from "solari-reflex";
import { runCodex, type MCP_SERVERS } from "../lib/codex-arm.ts";
import { env } from "../lib/lane.ts";
import { ACCOUNTS, checkSheet, openSheet, ROWS } from "./calc-expenses.ts";

const OFF_UI = new Set(["solari_exec", "solari_run_code", "solari_run_command_bg", "solari_write_file", "solari_read_file", "solari_list_files", "solari_kill"]);

const mcp = (process.argv[2] ?? "stock") as keyof typeof MCP_SERVERS;
const count = Math.min(Number(process.argv[3] ?? 30), ROWS.length);
const rows = ROWS.slice(0, count);
const solari = new Solari({ apiKey: env("SOLARI_API_KEY") });

const desk = await solari.createDesktop();
try {
  const surface = await DesktopSurface.attach({ solari, sandboxId: desk.sandboxId });
  await openSheet(solari, surface, rows);
  const tools = mcp === "fast"
    ? "solari_desktop_observe and solari_desktop_act (or the screenshot, click, type and key tools)"
    : "the screenshot, click, type and key tools";
  const prompt = [
    `A Solari desktop is running with sessionId ${desk.sandboxId}. Call solari_connect with that sessionId first.`,
    "LibreOffice Calc is open on it with expenses.ods: card transactions in rows 2 to " + (count + 1) + ", columns Date, Vendor, Memo, Amount, and an empty Category column (E).",
    `Fill in the Category for every row with exactly one of these accounts, spelled exactly as written:`,
    ...Object.entries(ACCOUNTS).map(([k, v]) => `- ${k}: ${v}`),
    `Work only through Calc's user interface with ${tools}. Do not use exec, run_code, run_command_bg, read_file, write_file or list_files, and do not edit the file any other way.`,
    "When every row has a category, save with Ctrl+S (keep the current format if asked) and reply with one line saying you are done.",
  ].join("\n");
  console.log(`desktop ${desk.sandboxId} ready; codex (${mcp} MCP) on ${count} rows…`);
  const r = await runCodex({
    prompt, mcp, solariApiKey: env("SOLARI_API_KEY"), budgetMs: 60 * 60_000,
    onToolCall: (c) => console.log(`${c.atS.toFixed(1).padStart(7)}s  ${c.status.padEnd(9)} ${c.tool}`),
  });
  const offUi = r.toolCalls.filter((c) => OFF_UI.has(c.tool)).map((c) => c.tool);
  const { results, correct } = await checkSheet(solari, desk.sandboxId, rows);
  const dir = join("runs", `calc-codex-${mcp}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(dir, { recursive: true });
  // The fork's MCP server restarts reflexd with its own token, so this surface may be locked out.
  const shot = await surface.screenshot().catch(() => undefined);
  if (shot) writeFileSync(join(dir, "final.jpg"), shot);
  writeFileSync(join(dir, "run.json"), JSON.stringify({ rows: count, prompt, correct, offUi, results, ...r, events: undefined }, null, 2));
  for (const x of results.filter((x) => !x.ok)) console.log(`  MISMATCH row ${x.row}: ${x.vendor} — expected ${x.expected}, saved "${x.saved}"`);
  console.log(JSON.stringify({ mcp, rows: count, correct, seconds: r.seconds, toolCalls: r.toolCalls.length, offUi, usage: r.usage, final: r.finalMessage.slice(0, 200) }, null, 2));
} finally {
  await solari.deleteSandbox(desk.sandboxId).catch(() => undefined);
  console.log("desktop deleted");
}
