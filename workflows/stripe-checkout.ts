// Stripe Checkout, for real, in test mode: N lanes, each a different buyer and
// scenario, each on its own Solari browser. Every lane is judged by Stripe's
// API afterwards (a completed or failed Checkout Session with that buyer's
// email), never by what the agent reports.
//
//   node --env-file=.env workflows/stripe-checkout.ts [lanes=4]

import { join } from "node:path";
import { env, runLane, type LaneSpec } from "../lib/lane.ts";

const STRIPE = "https://api.stripe.com/v1";
const sk = env("STRIPE_TEST_SECRET_KEY");
if (!sk.startsWith("sk_test_")) throw new Error("refusing to run against a live Stripe key");

async function stripe<T = Record<string, any>>(method: "GET" | "POST", path: string, form?: Record<string, string>): Promise<T> {
  const url = method === "GET" && form ? `${STRIPE}/${path}?${new URLSearchParams(form)}` : `${STRIPE}/${path}`;
  const r = await fetch(url, {
    method, headers: { Authorization: `Bearer ${sk}` },
    ...(method === "POST" && form ? { body: new URLSearchParams(form) } : {}),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`stripe ${path}: ${JSON.stringify(j).slice(0, 300)}`);
  return j as T;
}

/** One product, a price, a promotion code and a payment link, tagged so reruns reuse them. */
async function setup(): Promise<{ url: string; linkId: string; promo: string }> {
  const found = await stripe<{ data: any[] }>("GET", "payment_links", { limit: "50", active: "true" });
  const existing = found.data.find((l) => l.metadata?.demo === "solari-fast-checkout");
  const promo = "SOLARI20";
  if (existing) return { url: existing.url, linkId: existing.id, promo };
  const product = await stripe("POST", "products", { name: "Solari desk lamp", "metadata[demo]": "solari-fast" });
  const price = await stripe("POST", "prices", { product: product.id, unit_amount: "4900", currency: "usd" });
  const coupon = await stripe("POST", "coupons", { percent_off: "20", duration: "once", "metadata[demo]": "solari-fast" });
  await stripe("POST", "promotion_codes", { coupon: coupon.id, code: promo }).catch(() => undefined);
  const link = await stripe("POST", "payment_links", {
    "line_items[0][price]": price.id, "line_items[0][quantity]": "1",
    "line_items[0][adjustable_quantity][enabled]": "true", "line_items[0][adjustable_quantity][maximum]": "10",
    allow_promotion_codes: "true", "metadata[demo]": "solari-fast-checkout",
  });
  return { url: link.url, linkId: link.id, promo };
}

interface Scenario { name: string; email: string; card: string; expect: "paid" | "declined"; qty?: number; promo?: boolean }

const SCENARIOS: Scenario[] = [
  { name: "visa-2-lamps-promo", email: "ada+visa@example.com", card: "4242 4242 4242 4242", expect: "paid", qty: 2, promo: true },
  { name: "declined-card", email: "grace+decline@example.com", card: "4000 0000 0000 0002", expect: "declined" },
  { name: "mastercard-3-lamps", email: "linus+mc@example.com", card: "5555 5555 5555 4444", expect: "paid", qty: 3 },
  { name: "insufficient-funds", email: "barbara+funds@example.com", card: "4000 0000 0000 9995", expect: "declined" },
  { name: "amex-promo", email: "ken+amex@example.com", card: "3782 822463 10005", expect: "paid", promo: true },
  { name: "visa-debit-4-lamps", email: "margaret+debit@example.com", card: "4000 0566 5566 5556", expect: "paid", qty: 4 },
];

function goalFor(s: Scenario, promo: string): string {
  const parts = [
    s.qty && s.qty > 1 ? `Set the quantity to ${s.qty}.` : "",
    s.promo ? `Apply the promotion code ${promo}.` : "",
    `Pay by card: email ${s.email}, card number ${s.card}, expiry 12 / 34, CVC ${s.card.startsWith("3") ? "1234" : "123"}, cardholder name ${s.email.split("+")[0]!.replace(/^./, (c) => c.toUpperCase())} Tester, ZIP 94107.`,
    "Untick \"Save my information for faster checkout\".",
    "Stop once the page shows the payment succeeded or that the card was declined.",
  ];
  return parts.filter(Boolean).join(" ");
}

/** What Stripe says happened for this buyer on this link. */
async function verdict(linkId: string, s: Scenario, since: number): Promise<"paid" | "declined" | "none"> {
  const sessions = await stripe<{ data: any[] }>("GET", "checkout/sessions", { payment_link: linkId, limit: "100", "created[gte]": String(since), "expand[]": "data.payment_intent" });
  const mine = sessions.data.filter((x) => x.customer_details?.email === s.email || x.customer_email === s.email);
  if (mine.some((x) => x.payment_status === "paid")) return "paid";
  if (mine.some((x) => x.payment_intent?.last_payment_error)) return "declined";
  // A declined attempt may leave the session open with no email recorded yet; look at its intents.
  const intents = await stripe<{ data: any[] }>("GET", "payment_intents", { limit: "100", "created[gte]": String(since) });
  if (intents.data.some((pi) => pi.last_payment_error && (pi.receipt_email === s.email || pi.last_payment_error?.payment_method?.billing_details?.email === s.email))) return "declined";
  return "none";
}

const lanes = Number(process.argv[2] ?? 4);
const { url, linkId, promo } = await setup();
console.log(`payment link ${url}`);
const since = Math.floor(Date.now() / 1000) - 5;
const runDir = join("runs", `stripe-checkout-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const picked = SCENARIOS.slice(0, lanes);
const started = performance.now();
const results = await Promise.all(picked.map((s) => runLane({
  name: s.name, startUrl: url, goal: goalFor(s, promo), maxSteps: 40,
} satisfies LaneSpec, runDir).catch((e) => ({ name: s.name, error: (e as Error).message }))));
const wall = (performance.now() - started) / 1000;

console.log("\nchecking every lane with Stripe's API…");
const rows = [];
for (const s of picked) {
  const r = results.find((x) => x.name === s.name)!;
  const v = await verdict(linkId, s, since);
  rows.push({
    lane: s.name, expected: s.expect, stripe_says: v, correct: v === s.expect ? "yes" : "NO",
    seconds: "report" in r ? +(r.report.timings.totalMs / 1000).toFixed(1) : null,
    steps: "report" in r ? r.report.steps.length : null,
    agent: "report" in r ? r.report.status : `error: ${(r as { error: string }).error.slice(0, 60)}`,
    cost: "report" in r ? +r.report.usage.costUsd.toFixed(4) : null,
  });
}
console.table(rows);
console.log(`${rows.filter((r) => r.correct === "yes").length}/${rows.length} lanes verified by Stripe, ${wall.toFixed(1)} s wall clock for all lanes`);
