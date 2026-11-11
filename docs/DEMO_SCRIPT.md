# Demo video script (target: 2:40, hard limit 3:00)

**Quickest option:** with the app running and connected, run `npm run record:demo -- http://localhost:3000`. It records a 2-minute captioned walkthrough to `demo-video/spendguard-demo.mp4` (needs Chrome and ffmpeg). The script below is for recording it yourself with a voice-over.

Record your phone screen, or the browser at phone size (Chrome DevTools → device toolbar → iPhone 14).
Before recording: set `COOL_OFF_MINUTES=1`, open **Budgets → Reset demo data**, and use royalty-free music or none at all.

| Time | Screen | What to say |
|---|---|---|
| 0:00–0:15 | Title card, then the Home screen | "Every budgeting app tells you that you overspent *after* the money's gone. SpendGuard is an AI that checks every PayPal payment *before* it leaves your account." |
| 0:15–0:40 | Home: KPIs, alerts, AI insights | "It syncs my whole month from PayPal's Transaction Search API: sales, payouts, fees and refunds. Claude sorts every transaction into a category and spots things like food spending being up, forgotten subscriptions, and this $449 payment made at 2 AM to a merchant I've never paid before." |
| 0:40–0:55 | Scroll: donut chart, daily chart, budgets, subscriptions | "Here's where my money goes, how I'm doing against each budget, and every subscription it detected." |
| 0:55–1:35 | **Pay → "Shoes, $120" → Check this payment** | "Now the main feature. I'll try to buy $120 shoes at 11 PM. SpendGuard checks the payment *before* calling PayPal. My Shopping budget is set to Block, so it stops the payment and shows exactly how far over I'd go. I can wait and decide later, or override, but only by writing down why." Tap **Wait, then decide**. |
| 1:35–1:55 | **Pay → "Prize fee", $650** | "This one's a classic scam: a large payment to someone I've never paid. It's far above my normal spending, so SpendGuard warns me before a single dollar moves." Tap **Cancel**. |
| 1:55–2:15 | **Pay → "Designer, $180" → Send with PayPal** | "A normal payment goes straight through as a real PayPal sandbox payout. Here's the batch ID from PayPal." |
| 2:15–2:35 | **Ask AI:** "Can I afford a $300 phone?", then "Which subscriptions should I cancel?" | "And I can just ask my PayPal. Claude answers using tools that calculate the exact numbers, so it never makes them up." |
| 2:35–2:50 | Activity grid: change a category | "Every transaction is in an AG Grid table, and if I fix a category, SpendGuard remembers it." |
| 2:50–3:00 | Home | "SpendGuard: it checks before you spend. Built with PayPal and Claude." |

Tips: speak slowly, zoom in on the guard sheet, and keep total length under 3:00, since judges don't have to watch past that.
