// Sign in once to the SaaS apps the workflows use, so their browsers start signed in.
//
// For each app this finds or creates a Solari browser profile and asks Solari for a login
// handoff: a link to a Solari-hosted browser where you sign in yourself (2FA included).
// When you save there, the profile holds the session. Your password and cookies stay in
// Solari; they never pass through this script, the agent or any model.
//
//   node --env-file=.env scripts/login.ts                 # every app, one after another
//   node --env-file=.env scripts/login.ts salesforce      # just one

import { Solari } from "solari-reflex";
import { env } from "../lib/lane.ts";

export const APPS = {
  salesforce: { profile: "salesforce", url: "https://login.salesforce.com", what: "your Salesforce developer org" },
  hubspot: { profile: "hubspot", url: "https://app.hubspot.com/login", what: "your HubSpot test portal" },
  quickbooks: { profile: "quickbooks", url: "https://app.sandbox.qbo.intuit.com", what: "your QuickBooks Online sandbox company" },
  stripe: { profile: "stripe-dashboard", url: "https://dashboard.stripe.com/test/dashboard", what: "the Stripe dashboard, in test mode" },
} as const;

const solari = new Solari({ apiKey: env("SOLARI_API_KEY") });
const picked = process.argv[2] ? [process.argv[2] as keyof typeof APPS] : (Object.keys(APPS) as (keyof typeof APPS)[]);
for (const name of picked) {
  const app = APPS[name];
  if (!app) throw new Error(`unknown app ${name}; one of ${Object.keys(APPS).join(", ")}`);
  const profile = await solari.ensureProfile(app.profile);
  const login = await solari.requestProfileLogin(profile.id, `Sign in to ${app.what} at ${app.url}, then save.`);
  console.log(`\n${name}: open this link, go to ${app.url}, sign in to ${app.what}, then save:\n  ${login.url}\n  (expires ${login.expiresAt})`);
  const saved = await solari.waitForProfileLogin(profile.id, login.version, { timeoutMs: 10 * 60_000 });
  console.log(saved ? `${name}: saved to profile ${profile.id}` : `${name}: not saved before the link expired; run this again for a fresh link`);
}
