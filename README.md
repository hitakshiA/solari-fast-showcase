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

## Results so far

### `stripe-checkout`: 6 buyers in parallel on real Stripe Checkout (test mode)

Each lane is its own Solari browser.

| Lane | Scenario | Stripe says | Steps (by Jev) | Time | Model cost |
|---|---|---|---|---|---|
| visa-2-lamps-promo | quantity 2, promotion code, Visa | paid | 17 (15) | 55.3 s | $0.012 |
| declined-card | `4000…0002` | declined | 11 (10) | 39.7 s | $0.009 |
| mastercard-3-lamps | quantity 3, Mastercard | paid | 14 (12) | 48.2 s | $0.013 |
| insufficient-funds | `4000…9995` | declined | 11 (10) | 37.6 s | $0.008 |
| amex-promo | promotion code, Amex | paid | 14 (13) | 44.4 s | $0.010 |
| visa-debit-4-lamps | quantity 4, Visa debit | paid | 14 (11) | 46.3 s | $0.014 |

- **6 of 6 lanes verified by Stripe's API.**
- **60 s wall clock** for all six.
- **71 of 81 steps decided by Jev.** The other 10 came from the Advisor, when Jev's confidence was below 0.6.
- **$0.065 of model spend** in total.

This was driven from Bengaluru against Solari's us-west region. Each lane is recorded as an MP4, with the overlay showing the numbered controls, Jev's pick and its runner-ups.

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
