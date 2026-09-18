// Expense categorisation in LibreOffice Calc on a Solari desktop.
//
// 30 card transactions arrive in a spreadsheet with an empty Category column. The workflow
// reads the sheet once from the accessibility tree, asks Jev all 30 questions at once (each
// a choice over 12 accounts), then writes every answer into its cell through Calc's own UI
// and saves with Ctrl+S. Nothing edits the file behind Calc's back.
//
// The saved file is then converted by a separate LibreOffice instance and compared with an
// answer key that the agent never sees. The run is recorded with the boxes and
// probabilities drawn over the screen.
//
//   node --env-file=.env workflows/calc-expenses.ts [rows=30]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopRecorder, DesktopSurface, JevClient, Solari, type ObservedElement, type OverlayState } from "solari-reflex";
import { env } from "../lib/lane.ts";

export const ACCOUNTS: Record<string, string> = {
  "Travel": "Flights, hotels, trains, taxis and rideshare for business trips",
  "Meals": "Restaurants, coffee, catering and food delivery",
  "Software": "SaaS subscriptions, cloud hosting and developer tools",
  "Hardware": "Computers, monitors, phones and other equipment",
  "Office Supplies": "Paper, stationery, printer ink and small office items",
  "Advertising": "Ads, sponsorships and marketing campaigns",
  "Utilities": "Electricity, internet, phone and water bills",
  "Rent": "Office rent and coworking memberships",
  "Payroll": "Salaries, contractors paid through payroll and payroll providers",
  "Professional Services": "Lawyers, accountants, consultants and agencies",
  "Shipping": "Couriers, postage and freight",
  "Bank Fees": "Card, wire, FX and account fees",
};

// Vendor, memo, amount, and the answer key (never shown to the agent).
export const ROWS: [string, string, string, string][] = [
  ["Delta Air Lines", "Flight SFO-JFK for customer visit", "412.20", "Travel"],
  ["Amazon Web Services", "EC2 and S3, September", "1290.00", "Software"],
  ["Staples", "Printer paper and toner", "84.75", "Office Supplies"],
  ["Uber", "Ride from JFK to client office", "63.40", "Travel"],
  ["Sweetgreen", "Team lunch", "118.60", "Meals"],
  ["Apple", "MacBook Pro for new engineer", "2499.00", "Hardware"],
  ["Google Ads", "Search campaign, week 36", "750.00", "Advertising"],
  ["Comcast Business", "Office internet, September", "189.99", "Utilities"],
  ["WeWork", "Hot desk membership, 4 seats", "1600.00", "Rent"],
  ["Gusto", "Payroll run 2026-09-15", "38420.55", "Payroll"],
  ["Cooley LLP", "Legal review of customer MSA", "3200.00", "Professional Services"],
  ["FedEx", "Overnight shipment of hardware samples", "96.30", "Shipping"],
  ["Chase", "International wire fee", "45.00", "Bank Fees"],
  ["Marriott", "Hotel, 2 nights, Boston offsite", "688.40", "Travel"],
  ["Blue Bottle Coffee", "Coffee with candidate", "14.25", "Meals"],
  ["GitHub", "Team plan, 20 seats", "84.00", "Software"],
  ["Dell", "Two 27-inch monitors", "598.00", "Hardware"],
  ["LinkedIn", "Sponsored job post campaign", "420.00", "Advertising"],
  ["PG&E", "Office electricity, August", "212.37", "Utilities"],
  ["Deloitte", "Quarterly tax advisory", "4800.00", "Professional Services"],
  ["UPS", "Return shipment to vendor", "28.90", "Shipping"],
  ["Stripe", "Card processing fees, September", "362.18", "Bank Fees"],
  ["DoorDash", "Dinner for late release night", "146.80", "Meals"],
  ["Figma", "Organization plan, annual", "900.00", "Software"],
  ["Amtrak", "Train NYC to Washington DC", "142.00", "Travel"],
  ["Office Depot", "Whiteboard markers and sticky notes", "37.45", "Office Supplies"],
  ["Meta Ads", "Retargeting campaign", "515.00", "Advertising"],
  ["Verizon", "Company phone plan", "240.00", "Utilities"],
  ["Logitech", "Webcams for meeting rooms", "329.97", "Hardware"],
  ["USPS", "Certified mail for contracts", "19.35", "Shipping"],
];

export const SHEET = "/home/desktop/work/expenses.ods";

const sh = async (solari: Solari, id: string, script: string, timeoutMs = 120_000) => {
  const r = await solari.exec(id, "bash", ["-c", script], timeoutMs);
  if (r.exitCode !== 0) throw new Error(`exec failed: ${(r.stderr || r.stdout).slice(-300)}`);
  return r.stdout;
};
const asDesktop = (cmd: string) => `runuser -u "$(cat /opt/reflex/user)" -- bash -c 'set -a; . /opt/reflex/session.env; set +a; ${cmd}'`;

/** Write the transactions (without the answer key) to SHEET and open it in Calc. */
export async function openSheet(solari: Solari, surface: DesktopSurface, rows: typeof ROWS): Promise<void> {
  const csv = ["Date,Vendor,Memo,Amount,Category", ...rows.map(([v, m, a], i) => `2026-09-${String(i + 1).padStart(2, "0")},"${v}","${m}",${a},`)].join("\n");
  await sh(solari, surface.sandboxId, `mkdir -p /home/desktop/work && cat > /home/desktop/work/expenses.csv <<'CSV'\n${csv}\nCSV\ncd /home/desktop/work && soffice --headless --convert-to ods expenses.csv >/dev/null 2>&1; chown -R "$(cat /opt/reflex/user)" /home/desktop/work`);
  await surface.launch("soffice", ["--calc", "--norestore", "--nologo", SHEET], { waitMs: 90_000 });
  await new Promise((r) => setTimeout(r, 2000));
}

/** Save through Calc (Ctrl+S; .ods needs no format dialog). */
export const saveSheet = (solari: Solari, id: string) => sh(solari, id, asDesktop("xdotool key --clearmodifiers ctrl+s") + "; sleep 3");

/** Convert a copy of the saved file with a separate LibreOffice profile and compare it with the key. */
export async function checkSheet(solari: Solari, id: string, rows: typeof ROWS) {
  const out = await sh(solari, id, `cp ${SHEET} /tmp/check.ods && cd /tmp && soffice -env:UserInstallation=file:///tmp/lo-check --headless --convert-to csv check.ods >/dev/null 2>&1; cat /tmp/check.csv`);
  const saved = out.trim().split("\n").slice(1).map((l) => l.split(",").at(-1)!.replace(/"/g, "").trim());
  const results = rows.map(([v, m, , key], i) => ({ row: i + 2, vendor: v, memo: m, expected: key, saved: saved[i] ?? "", ok: (saved[i] ?? "") === key }));
  return { results, correct: results.filter((x) => x.ok).length };
}

/**
 * LibreOffice reports sheet cells this many pixels above where it draws them (the other
 * controls are right). Only the video overlay uses it; input goes through accessibility.
 */
const CALC_CELL_DY = 25;
const onScreen = (e: ObservedElement) => e.role === "gridcell" && e.rect ? { ...e, rect: { ...e.rect, y: e.rect.y + CALC_CELL_DY } } : e;

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const count = Math.min(Number(process.argv[2] ?? 30), ROWS.length);
  const rows = ROWS.slice(0, count);
  const solari = new Solari({ apiKey: env("SOLARI_API_KEY") });
  const jev = new JevClient({ apiKey: env("OPENROUTER_API_KEY") });
  const runDir = join("runs", `calc-expenses-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(runDir, { recursive: true });

  const desk = await solari.createDesktop();
  console.log(`desktop ${desk.createMs} ms`);
  try {
    const surface = await DesktopSurface.attach({ solari, sandboxId: desk.sandboxId });
    await openSheet(solari, surface, rows);
    const recorder = new DesktopRecorder(surface, { dir: runDir });
    await recorder.start();
    const started = performance.now();
    const clock = () => `${((performance.now() - started) / 1000).toFixed(1)} s`;
    const boxes = (o: { elements: ObservedElement[] }, pending: Set<string>) => o.elements
      .filter((e) => pending.has(e.name) && e.rect && e.rect.y + CALC_CELL_DY < 660)
      .map((e) => { const s = onScreen(e); return { id: s.name, label: s.name, rect: s.rect! }; });

    // Page by page, like a person: read what the screen shows, decide every visible row at
    // once, write the answers, then move the view to the next empty cell.
    const pending = new Set(rows.map((_, i) => `E${i + 2}`));
    const decisions: { r: number; rowText: string; ms: number; cost: number; choice: string; confidence: number; probabilities: Record<string, number> }[] = [];
    let spend = 0;
    let o = await surface.observe();
    while (pending.size > 0) {
      // 1. The rows on screen whose Category is still empty.
      const t0 = performance.now();
      const visible = rows.map((_, i) => i + 2)
        .filter((r) => pending.has(`E${r}`))
        .map((r) => ({ r, rowText: o.text.split("\n").find((l) => l.startsWith(`Row ${r}:`)) ?? "" }))
        .filter((x) => x.rowText);
      if (visible.length === 0) throw new Error(`none of ${[...pending].join(", ")} is on screen`);
      recorder.mark({ boxes: boxes(o, pending), hud: `calc · ${visible.length} rows on screen · asking Jev ${visible.length} questions at once · ${clock()}`, source: "jev" });

      // 2. One Jev choice per row, all in flight together.
      const page = await Promise.all(visible.map(async ({ r, rowText }) => {
        const q0 = performance.now();
        const d = await jev.ask(
          { transaction: rowText.replace(/^Row \d+: /, ""), columns: "A=Date, B=Vendor, C=Memo, D=Amount" },
          { account: { type: "choice", instructions: "Which expense account does this card transaction belong to?", criteria: ACCOUNTS } },
        );
        return { r, rowText, ms: Math.round(performance.now() - q0), cost: d.usage.cost ?? 0, ...d.answers.account };
      }));
      spend += page.reduce((s, d) => s + d.cost, 0);
      console.log(`${visible.length} rows read and decided in ${Math.round(performance.now() - t0)} ms (slowest Jev call ${Math.max(...page.map((d) => d.ms))} ms)`);

      // 3. Write each answer into its cell through Calc.
      for (const d of page) {
        const address = `E${d.r}`;
        const cell = o.elements.find((e) => e.role === "gridcell" && e.name === address);
        if (!cell) throw new Error(`${address} is not in the observation`);
        const top = Object.entries(d.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3) as [string, number][];
        recorder.mark({
          boxes: boxes(o, pending),
          chosen: { id: address, operation: `← ${d.choice}`, confidence: d.confidence },
          alternatives: top,
          hud: `calc · ${address} ← ${d.choice} · jev ${(d.ms / 1000).toFixed(2)} s · ${clock()} · $${spend.toFixed(4)}`,
          source: "jev",
        });
        const a0 = performance.now();
        await surface.act({ kind: "type", element: cell, text: d.choice }, o);
        pending.delete(address);
        decisions.push(d);
        console.log(`${address.padEnd(4)} ${String(Math.round(performance.now() - a0)).padStart(4)} ms  ${d.choice.padEnd(22)} ${d.confidence.toFixed(2)}  ${d.rowText.slice(0, 64)}`);
      }

      // 4. Jump to the last empty cell with the Name Box: Calc scrolls it to the bottom of the
      //    view, which brings as many of the remaining rows on screen as fit. Read again.
      o = await surface.observe();
      const next = [...pending].at(-1);
      if (next) {
        const nameBox = o.elements.find((e) => e.editable && /^[A-Z]{1,3}\d+$/.test(e.value ?? ""));
        if (!nameBox) throw new Error("Calc's Name Box is not in the observation");
        recorder.mark({ boxes: [{ id: "Name Box", label: "", rect: nameBox.rect! }], chosen: { id: "Name Box", operation: `type ${next} ⏎`, confidence: 1 }, hud: `calc · jump to ${next} · ${clock()}`, source: "jev" });
        await surface.act({ kind: "type", element: nameBox, text: next, submit: true }, o);
        o = await surface.observe();
      }
    }
    await saveSheet(solari, desk.sandboxId);
    const totalS = (performance.now() - started) / 1000;
    recorder.mark({ boxes: [], hud: `calc · ${count} rows written and saved · ${totalS.toFixed(1)} s · $${spend.toFixed(4)}`, source: "jev" });
    await new Promise((r) => setTimeout(r, 1500));
    writeFileSync(join(runDir, "final.jpg"), await surface.screenshot());
    const video = await recorder.stop();

    const { results, correct } = await checkSheet(solari, desk.sandboxId, rows);
    writeFileSync(join(runDir, "report.json"), JSON.stringify({ rows: count, totalS, spend, decisions, results }, null, 2));
    for (const x of results.filter((x) => !x.ok)) console.log(`  MISMATCH row ${x.row}: ${x.vendor} — expected ${x.expected}, saved "${x.saved}"`);
    console.log(`\n${correct}/${count} rows correct in the saved file · ${totalS.toFixed(1)} s for ${count} rows · Jev spend $${spend.toFixed(4)} · ${video}`);
  } finally {
    await solari.deleteSandbox(desk.sandboxId).catch(() => undefined);
    console.log("desktop deleted");
  }
}
