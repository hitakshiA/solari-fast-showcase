# solari-fast-showcase

Long, real workflows on [Solari](https://getsolari.com) browsers and desktops, done two ways and verified independently:

- **solari-reflex:** reads the screen as numbered controls, has [Jev](https://docs.typesafe.ai) choose each step, and verifies every action. See [hitakshiA/solari-reflex](https://github.com/hitakshiA/solari-reflex).
- **The stock loop:** Codex CLI with GPT-6 Astra, driving Solari through Solari's own MCP server ([`@solarisdk/mcp`](https://www.npmjs.com/package/@solarisdk/mcp)). The same Codex is also run against our fork, [hitakshiA/solari-mcp](https://github.com/hitakshiA/solari-mcp).

Every lane is judged by the app it worked in (Stripe's API, the saved spreadsheet, the database), never by what the agent says. Every lane is recorded with an overlay showing what the agent saw and chose.

> Work in progress. Results and videos are added as each workflow lands.

## Workflows

| Workflow | Surface | Real app | Verified by |
|---|---|---|---|
| [`stripe-checkout`](workflows/stripe-checkout.ts) | Browser (N lanes) | Stripe Checkout, test mode | Stripe API: Checkout Sessions and PaymentIntents per buyer |

## First results

`stripe-checkout`, one lane (quantity 2, promotion code, card, email, name, ZIP, untick "save my information", pay):

| Agent | Stripe says | Steps | Time | Model cost |
|---|---|---|---|---|
| solari-reflex (Jev, with Gemini 3.5 Flash for plan and advice, Mercury 2.5 for text) | paid | 24 (21 decided by Jev) | 74 s | $0.017 |

This was driven from Bengaluru against Solari's us-west region, so every call carries a trans-Pacific round trip.

## Run

Clone this repo next to [solari-reflex](https://github.com/hitakshiA/solari-reflex) and build that first (`npm install && npm run build`), then:

```bash
npm install
cat > .env <<'KEYS'
SOLARI_API_KEY=slr_live_...
OPENROUTER_API_KEY=sk-or-...          # Jev (TypeSafe on OpenRouter), the planner, the text writer
STRIPE_TEST_SECRET_KEY=sk_test_...    # test mode only; the script refuses a live key
KEYS
node --env-file=.env workflows/stripe-checkout.ts 4
```

The Codex baseline (`lib/codex-arm.ts`) needs the Codex CLI signed in with ChatGPT, plus `npm install` in `codex/`.
