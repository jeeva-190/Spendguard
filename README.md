# 🛡️ SpendGuard: an AI that checks every PayPal payment before it goes out

**Expense trackers tell you that you overspent after it has happened. SpendGuard steps in before the money leaves your PayPal account.**

SpendGuard connects to a PayPal business account. It reads every payment for the month, uses AI to sort each one into a category, explains where the money is going, and lets you ask questions in plain English. When you send a payment through it, it checks the payment against your budgets and habits *before* calling PayPal, and can block it if needed.

Built for the **PayPal AI Hackathon 2026: "Build What's Next with PayPal and AI"**.

---

## What it does

| | Feature | PayPal | AI |
|---|---|---|---|
| 🛡️ | **Pre-payment guard.** Every outgoing payment is checked first. The result is ✅ allow, ✋ warn (pay anyway or wait 24 hours) or 🛑 block (overriding a block needs a written reason). | Payouts API (`/v1/payments/payouts`) is only called after the guard passes | the AI explains the decision in plain language and picks the category |
| 📥 | **Monthly sync.** Pulls in all money in and out, including PayPal fees, refunds and withdrawals | Transaction Search API (`/v1/reporting/transactions`) | — |
| 🏷️ | **AI categorization.** Each transaction gets a category, a clean merchant name and a subscription flag. Corrections from the user stick. | — | Your AI, in batches, with results cached |
| 💬 | **Ask your PayPal.** For example: "How much did I spend on ads vs last month?" or "Can I afford a $300 phone?" | — | Any AI with tool calling. All numbers come from code-backed tools, never from the AI guessing |
| ✨ | **AI insights.** Spending spikes, forgotten subscriptions, unusual payments, how much fees cost you, and whether you're on pace for your budget | — | The AI writes the insights from facts calculated in code |
| 🎯 | **Budgets and alerts.** Each budget is set to Alert or Block. You get alerts at 80% and 100%, when you're on pace to overspend, and when an unusual payment appears. | — | — |
| 📋 | **Activity grid.** Search, sort, filter, and change a category inline | — | — |

### Why the AI can't be tricked into approving a payment

The **decision is made by plain code** in `src/guard.js`, using budgets, typical payment sizes, duplicate detection, first-time payees, late-night impulse rules and cash flow. The AI only *explains* the decision. Typing something like "ignore your rules" into the payment note can't unblock a payment. The server also re-checks the rules at the moment of payment, so a payment that became riskier in the meantime is caught again.

---

## Quick start (5 minutes)

**Requirements:** Node 18.17 or newer.

```bash
git clone <your-repo-url> spendguard && cd spendguard
npm install
cp .env.example .env      # then fill in the keys (see below)
npm start                 # http://localhost:3000
```

The app works even with **no keys**. It runs on realistic sample data, uses rule-based categories, and simulates payments, showing the exact PayPal Payouts API request it would send.

### Adding keys: two ways

- **In the app (recommended for judges and other users):** open **Settings** (the gear icon) and paste your own PayPal sandbox Client ID and Secret, and an API key from **any AI provider**: Claude, OpenAI, Google Gemini, Groq, OpenRouter, DeepSeek, Mistral, or any OpenAI-compatible API that supports tool calling. SpendGuard guesses the provider from the key, lets you pick the model, and runs a small test call before saving the key. Keys are stored on the server **for that browser only**: each visitor gets a private session through an http-only cookie, keys are never sent back to the browser in full, and visitors never share keys or data. They can be removed at any time.
- **In `.env` (for the server owner):** these become the default "demo keys" for visitors who haven't added their own. Visitors' own keys always take priority. `AI_DAILY_LIMIT` only limits the server's own key.

What to get:

1. **PayPal sandbox**
   - Go to developer.paypal.com → *Apps & Credentials* → **Sandbox** → *Create App* (Merchant).
   - Copy the **Client ID** and **Secret** into `.env`.
   - In the app's *Features* list, make sure **Transaction search** and **Payouts** are ticked.
2. **AI (any provider):** put the key in `AI_API_KEY`. The provider is guessed from the key, or you can set `AI_PROVIDER`, plus `AI_MODEL` to change the model. `ANTHROPIC_API_KEY` still works too.
3. *(Optional)* Create real sandbox transactions:
   - Set `SANDBOX_RECEIVER_EMAIL` to the email of a sandbox **personal** account.
   - Run `npm run seed:sandbox`.
   - Note: PayPal can take up to about 3 hours to show new sandbox transactions in Transaction Search. Press ⟳ in the app to sync.

`DEMO_DATA=true` (the default) mixes three months of sample history in with your sandbox data, because new sandbox accounts are nearly empty. Sample rows are labelled *Sample* in the Activity grid.

## Demo video

`npm run record:demo -- http://localhost:3000` records a captioned walkthrough to `demo-video/spendguard-demo.mp4`. It needs Chrome and ffmpeg. For a voice-over, first run `python scripts/make-voice.py <model-folder>`: it uses Kokoro, an open-source (Apache-2.0) text-to-speech model, reads the narration in `scripts/narration.json`, and the video is then timed to the voice.

## Deploy (Render, free)

`render.yaml` is included. In Render, choose **New → Blueprint**, pick this repo, then paste `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `ANTHROPIC_API_KEY`. On Render the cool-off defaults to 2 minutes, so judges can see the whole flow. Note that the free plan has temporary storage: data resets on each redeploy, and sample data is re-created automatically.

## For judges: try it in 60 seconds

1. **Home:** look at "Safe to spend today", the alerts, the AI notes, the day-by-day calendar, the budgets and the detected subscriptions.
2. **Pay → "Shoes, $120" → Check this payment.** The Shopping budget is set to *Block*, so SpendGuard stops the payment and shows its effect on the budget. Try "Wait, then decide", or override with a reason.
3. **Pay → "Prize fee", $650.** This is a $650 payment to a first-time payee that's far above normal, so it shows the scam-style warning.
4. **Pay → "Designer, $180".** This is a normal payment. It's allowed and sent as a PayPal sandbox payout.
5. **Ask AI:** tap any suggested question.
6. **Activity:** change a category. Home and the insights update.

## Architecture

```
public/            Single-page app: vanilla JS, Chart.js, AG Grid Community (installable on phones)
server.js          Express API
src/paypal.js      OAuth, Transaction Search (31-day windows, pagination), Payouts
src/sync.js        Turns PayPal transactions into a common format (event codes → payment/payout/refund/withdrawal, fees)
src/analytics.js   All the money maths: summaries, fair same-period comparisons, projection, subscriptions, unusual payments
src/guard.js       Rules engine (allow/warn/block) + AI explanation
src/agent.js       "Ask your PayPal": AI tool-use loop over summarize / find / budgets / subscriptions / can_i_afford
src/insights.js    Facts → AI insight cards; rule-based alerts
src/ai.js          Works with any provider: Anthropic plus any OpenAI-compatible API. Structured output via forced tool calls, a tool-use agent loop, key checks, daily cost cap
src/demo.js        Sample data generator
```

**Safety and cost controls:** per-IP rate limits on AI endpoints, a daily AI call cap (`AI_DAILY_LIMIT`), and every piece of user-controlled text is escaped before display. The app refuses to seed a live account, and PayPal requests use idempotency keys (`PayPal-Request-Id`).

## Limitations (honest)

- PayPal doesn't let third-party apps block payments made inside PayPal's own app. SpendGuard guards the payments sent **through SpendGuard**, using the Payouts API. Built into a wallet, the same rules engine could check every payment.
- Transaction Search only covers the account that owns the API credentials, so SpendGuard is aimed at PayPal **business** accounts: freelancers, solo founders and small sellers.
- Data is stored in a JSON file, which is fine for a single-user demo. A production version would use a database and *Log in with PayPal*.

## License

MIT
