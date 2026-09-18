// Expense categorisation in LibreOffice Calc on a Solari desktop.
//
// 30 card transactions arrive in a spreadsheet with an empty Category column. For each
// row the workflow moves to the Category cell through Calc's Name Box, reads the row
// from the accessibility tree, has Jev choose one of 12 accounts, and types it in.
// Everything goes through Calc's own UI; nothing edits the file behind its back.
//
// The saved file is then converted by a separate LibreOffice instance and compared
// with an answer key that the agent never sees.
//
//   node --env-file=.env workflows/calc-expenses.ts [rows=30]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DesktopSurface, JevClient, Solari, type Observation } from "solari-reflex";
import { env } from "../lib/lane.ts";

const ACCOUNTS: Record<string, string> = {
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
const ROWS: [string, string, string, string][] = [
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

const count = Math.min(Number(process.argv[2] ?? 30), ROWS.length);
const rows = ROWS.slice(0, count);
const solari = new Solari({ apiKey: env("SOLARI_API_KEY") });
const jev = new JevClient({ apiKey: env("OPENROUTER_API_KEY") });
const runDir = join("runs", `calc-expenses-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(join(runDir, "frames"), { recursive: true });

const sh = async (id: string, script: string, timeoutMs = 120_000) => {
  const r = await solari.exec(id, "bash", ["-c", script], timeoutMs);
  if (r.exitCode !== 0) throw new Error(`exec failed: ${(r.stderr || r.stdout).slice(-300)}`);
  return r.stdout;
};
const asDesktop = (cmd: string) => `runuser -u "$(cat /opt/reflex/user)" -- bash -c 'set -a; . /opt/reflex/session.env; set +a; ${cmd}'`;

const desk = await solari.createDesktop();
console.log(`desktop ${desk.createMs} ms`);
try {
  const surface = await DesktopSurface.attach({ solari, sandboxId: desk.sandboxId });
  const csv = ["Date,Vendor,Memo,Amount,Category", ...rows.map(([v, m, a], i) => `2026-09-${String(i + 1).padStart(2, "0")},"${v}","${m}",${a},`)].join("\n");
  await sh(desk.sandboxId, `mkdir -p /home/desktop/work && cat > /home/desktop/work/expenses.csv <<'CSV'\n${csv}\nCSV\ncd /home/desktop/work && soffice --headless --convert-to ods expenses.csv >/dev/null 2>&1; chown -R "$(cat /opt/reflex/user)" /home/desktop/work`);
  await surface.launch("soffice", ["--calc", "--norestore", "--nologo", "/home/desktop/work/expenses.ods"], { waitMs: 90_000 });
  await new Promise((r) => setTimeout(r, 2000));

  const timings: { row: number; ms: number; chosen: string; confidence: number }[] = [];
  const started = performance.now();
  let spend = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = i + 2;
    const t0 = performance.now();
    // 1. Go to the Category cell through the Name Box.
    let o = await surface.observe();
    // Calc's Name Box is an unnamed entry whose value is the active cell's address ("A1").
    const nameBox = o.elements.find((e) => /name box/i.test(e.name))
      ?? o.elements.find((e) => e.editable && /^[A-Z]{1,3}\d+$/.test(e.value ?? ""));
    if (!nameBox) throw new Error("Calc's Name Box is not in the observation");
    await surface.act({ kind: "type", element: nameBox, text: `E${r}`, submit: true }, o);
    o = await surface.observe();
    // 2. Read the row the way the screen shows it, and let Jev choose the account.
    const rowText = o.text.split("\n").find((l) => l.startsWith(`Row ${r}:`)) ?? "";
    const decision = await jev.ask(
      { transaction: rowText.replace(/^Row \d+: /, ""), columns: "A=Date, B=Vendor, C=Memo, D=Amount" },
      { account: { type: "choice", instructions: "Which expense account does this card transaction belong to?", criteria: ACCOUNTS } },
    );
    spend += decision.usage.cost ?? 0;
    const chosen = decision.answers.account.choice;
    // 3. Type it into the active cell.
    const cell = o.elements.find((e) => e.role === "gridcell" && e.name === `E${r}`);
    if (!cell) throw new Error(`E${r} is not on screen after the Name Box jump`);
    await surface.act({ kind: "type", element: cell, text: chosen }, o);
    const ms = Math.round(performance.now() - t0);
    timings.push({ row: r, ms, chosen, confidence: decision.answers.account.confidence });
    console.log(`row ${String(r).padStart(2)}  ${String(ms).padStart(5)} ms  ${chosen.padEnd(22)} ${decision.answers.account.confidence.toFixed(2)}  ${rowText.slice(0, 70)}`);
    if (i % 5 === 4) writeFileSync(join(runDir, "frames", `row-${r}.jpg`), await surface.screenshot());
  }
  const totalS = (performance.now() - started) / 1000;

  // Save through Calc (Ctrl+S; .ods needs no format dialog).
  await sh(desk.sandboxId, asDesktop("xdotool key --clearmodifiers ctrl+s") + "; sleep 3");
  writeFileSync(join(runDir, "final.jpg"), await surface.screenshot());

  // Independent check: convert a copy with a separate LibreOffice profile, compare with the key.
  const out = await sh(desk.sandboxId, `cp /home/desktop/work/expenses.ods /tmp/check.ods && cd /tmp && soffice -env:UserInstallation=file:///tmp/lo-check --headless --convert-to csv check.ods >/dev/null 2>&1; cat /tmp/check.csv`);
  const saved = out.trim().split("\n").slice(1).map((l) => l.split(",").at(-1)!.replace(/"/g, "").trim());
  const results = rows.map(([v, m, , key], i) => ({ row: i + 2, vendor: v, memo: m, expected: key, saved: saved[i] ?? "", ok: (saved[i] ?? "") === key }));
  const correct = results.filter((x) => x.ok).length;
  writeFileSync(join(runDir, "report.json"), JSON.stringify({ rows: count, totalS, spend, timings, results }, null, 2));
  for (const x of results.filter((x) => !x.ok)) console.log(`  MISMATCH row ${x.row}: ${x.vendor} — expected ${x.expected}, saved "${x.saved}"`);
  console.log(`\n${correct}/${count} rows correct in the saved file · ${totalS.toFixed(1)} s for ${count} rows (${(totalS / count).toFixed(2)} s/row) · Jev spend $${spend.toFixed(4)}`);
} finally {
  await solari.deleteSandbox(desk.sandboxId).catch(() => undefined);
  console.log("desktop deleted");
}
