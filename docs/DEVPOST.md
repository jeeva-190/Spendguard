# Devpost submission — copy/paste

**Project name:** SpendGuard: Ask your PayPal

**Tagline:** An AI that checks every PayPal payment *before* it goes out, and explains where your money went.

---

## Inspiration
Every budgeting app tells you that you overspent **after** the money is gone. Freelancers and small online sellers run their whole business through PayPal: client payments come in, and contractors, ads, suppliers, subscriptions and the odd late-night impulse buy go out. We wanted something that steps in at the one moment that matters: **just before a payment leaves the account.**

## What it does
- 🛡️ **SpendGuard (pre-payment check).** Every outgoing payment is checked against your budgets and habits before PayPal is called. The result is **✅ allow**, **✋ warn** ("wait 24 hours, then decide" or "pay anyway") or **🛑 block**, where an override needs a written reason. It catches budget overruns, payments far above your usual size, possible duplicates, large payments to first-time payees (a common scam pattern), late-night impulse buys and negative monthly cash flow.
- 📥 **A month of PayPal, in one place.** Syncs every transaction (money in, money out, PayPal fees, refunds and withdrawals) from the PayPal Transaction Search API.
- 🏷️ **AI categorization.** Claude labels each transaction with a category and a clean merchant name, and flags subscriptions. Changing a category in the grid sticks.
- 💬 **Ask your PayPal.** Questions in plain English, such as *"Can I afford a $300 phone?"* or *"Compare my ad spend with last month."*
- ✨ **AI insights.** Spending spikes (compared against the same days of last month, to be fair), forgotten subscriptions, unusual payments, what fees cost you, and whether you're on pace for your budget.
- 🎯 **Budgets and alerts.** Each budget is set to Alert or Block. You get alerts at 80% and 100%, when you're on pace to overspend, and when an unusual payment appears.

## How we built it
- **PayPal:** OAuth client credentials; **Transaction Search** (`/v1/reporting/transactions`) with 31-day windows and pagination, event-code mapping and fee extraction; **Payouts** (`/v1/payments/payouts`) with idempotency keys, called *only* after the guard approves.
- **AI (any provider):** the AI layer works with Anthropic's API and any OpenAI-compatible API (OpenAI, Gemini, Groq, OpenRouter, DeepSeek, Mistral or a custom endpoint), so users bring their own key. The AI handles "Ask your PayPal" (a tool-use loop over code-backed tools: `summarize`, `find_transactions`, `budgets`, `subscriptions`, `can_i_afford`) and the insights, and also does batch categorization and the guard's explanations. All structured output uses forced tool calls with JSON schemas.
- **A key design rule: AI explains, code decides.** All money maths and every allow/warn/block decision is plain, testable code. The AI never invents numbers and can't be talked into approving a payment, and the server re-checks the rules at payment time.
- **Front end:** a phone-first, installable single-page app with **AG Grid** (editable categories, quick search) and Chart.js. **Back end:** Node and Express, deployed on **Render**.
- Includes cost and abuse limits (per-IP rate limits and a daily AI cap), so the public demo stays up for judges.

## Challenges
- New sandbox accounts have almost no history, so we built a realistic three-month sample generator that mixes with real sandbox data and is clearly labelled.
- Transaction Search only allows 31 days per request and can lag behind new sandbox activity, so we added a local ledger that records SpendGuard's own payouts instantly.
- Making AI numbers trustworthy: we moved every calculation into tools, so the model only reasons and writes.

## Accomplishments we're proud of
- A guard that's actually useful: a $120 shoe purchase gets stopped, with a clear picture of the budget before and after.
- Answers that come with receipts. Every "Ask" reply shows which tools it used to look up the data.

## What we learned
Agentic commerce needs **guardrails as a product feature**, not just as a safety layer. Users want an assistant that says "maybe not today" at the right moment.

## What's next
- Log in with PayPal for personal accounts, and webhooks for real-time alerts.
- Shared budgets for teams, where an employee's payment request needs the owner's approval.
- Applying the same rules engine to PayPal Checkout and Venmo, so every payment is checked, not only the ones sent through SpendGuard.

## Built with
`paypal-transaction-search-api` · `paypal-payouts-api` · `claude` · `anthropic-api` · `node.js` · `express` · `ag-grid` · `chart.js` · `render`

## Testing instructions for judges
**No keys needed to try it.** Run `npm install && npm start` and open http://localhost:3000. Or use the live link if one is listed above.

- Out of the box it runs in **demo mode**: three months of realistic sample PayPal history, built-in rules instead of the AI, and simulated payments. Every simulated payment shows the **exact PayPal Payouts API request** SpendGuard sends when keys are present.
- **To test with real PayPal sandbox and AI** (both free, no card needed): open **Settings**, paste a PayPal sandbox app's Client ID and Secret (developer.paypal.com → Apps & Credentials → Sandbox → Create App, with Transaction search and Payouts ticked) and an AI key. A free Groq key from console.groq.com works, as do Gemini, OpenAI, Claude and others. Each key is checked with a live call before it's saved.
- A 60-second tour is in the README under "For judges".
