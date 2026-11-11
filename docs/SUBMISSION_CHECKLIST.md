# Submission checklist

Deadline: **Thu Nov 12, 2026, 12:00 PM Pacific = Fri Nov 13, 1:30 AM India time.** Aim to submit on Thursday evening.

## 1. Get your keys (15 min)
- [ ] **PayPal sandbox:** go to developer.paypal.com → Apps & Credentials → **Sandbox** → Create App (Merchant). In the app's features, tick **Transaction search** and **Payouts**. Copy the **Client ID** and **Secret**.
- [ ] Under Sandbox → **Accounts**, note the email of the default **Personal** account. `npm run seed:sandbox` sends payouts to it.
- [ ] **AI key** from any provider: Claude, OpenAI, Gemini (free tier at aistudio.google.com), Groq, OpenRouter, DeepSeek or Mistral. Add a little credit so it lasts **until Dec 15**.

## 2. Run it on your computer (10 min)
```bash
cd spendguard
npm install
cp .env.example .env   # paste PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, AI_API_KEY
npm start              # open http://localhost:3000
```
- [ ] The line at the top says "Connected to PayPal sandbox" and "AI is on".
- [ ] `npm run seed:sandbox` (set `SANDBOX_RECEIVER_EMAIL` first) creates real sandbox payouts. PayPal can take up to about 3 hours to show them, then press ⟳.
- [ ] Pay → "Designer, $180" → **Send**. You should get a real PayPal **payout batch ID**, not "Simulated".
- [ ] If anything fails, copy the exact error message.

## 3. Publish the code (10 min)
Use your **personal** GitHub account, not a company or work organization. The rules say the project must be solely owned by you.
- [ ] github.com → New repository → name `spendguard` → **Public** → don't add a README or license (they're already here).
- [ ] Then, in the project folder:
```bash
git remote add origin https://github.com/<your-username>/spendguard.git
git push -u origin main
```
- [ ] On the repo page, the right side should show **MIT license** under About. Click the ⚙️ next to About and add the description: "AI that checks every PayPal payment before it goes out".

## 4. Put it online on Render (15 min)
- [ ] render.com → sign in with GitHub → **New → Blueprint** → pick `spendguard`. Render reads `render.yaml`.
- [ ] Fill in `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `AI_API_KEY`. Add `AI_PROVIDER` and `AI_MODEL` if needed. Deploy.
- [ ] Open the Render URL. It should work straight away with your keys as the "demo keys", so judges don't need their own.
- [ ] Note: the free plan sleeps after 15 minutes idle, and the first visit then takes about 30–60 seconds. Say so in the testing notes.

## 5. Video (20 min)
- [ ] A finished 2:09 captioned video with no music is included, recorded in demo mode. A version recorded with **your real keys** is stronger, since it shows real payout IDs. To make it, run the app connected, then: `npm run record:demo -- http://localhost:3000` (needs Chrome and ffmpeg). It saves `demo-video/spendguard-demo.mp4`.
- [ ] Optional: record your own voice over it, following `docs/DEMO_SCRIPT.md`. No copyrighted music, and no brand logos other than PayPal.
- [ ] Upload to YouTube with visibility **Public** (not Unlisted). Title: "SpendGuard — AI that checks every PayPal payment before it goes out".

## 6. Devpost (15 min)
- [ ] Project name, tagline, and the "About the project" sections: copy them from `docs/DEVPOST.md`.
- [ ] "Built with": paypal, paypal-payouts, paypal-transaction-search, node.js, express, ag-grid, render, and your AI provider.
- [ ] Links: GitHub repo URL, Render URL, YouTube URL.
- [ ] Testing instructions: the Render URL, "no login needed", "first load may take up to a minute (free hosting wakes up)", and "to use your own accounts, open Settings".
- [ ] Opt in to the sponsor prizes for **AG Grid** and **Render** if the form asks.
- [ ] **Save as a draft early**, then **Submit** before the deadline.

## 7. Keep it alive until Dec 15
- [ ] Don't delete the Render service or the PayPal sandbox app.
- [ ] Check that your AI key still has credit in early December.
