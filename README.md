# Fusion Predict (v1.0 test build)

AI football predictions by Fusion Labs. Screenshot a match, and the app reads the teams and any bookmaker odds, researches current form, team news and stats on the web, and runs a statistical match model.

## What it does
- **Screenshot or type a match.** The AI reads team names, competition, kick-off and odds. If there are several matches, you pick one.
- **Research.** Claude (Anthropic) with web search gathers the league table, home/away records, last 6 results, xG, injuries and suspensions, top scorers, rest days and head-to-head, with sources.
- **Match model** (`model.js`). Expected goals from venue-specific attack/defence strengths (shrunk towards the league average), blended with xG, recent form, absences and rest. Then a Dixon–Coles adjusted Poisson score matrix.
- **Results:** win/draw/loss chances, a pick with confidence, likely scores, goal lines, both-teams-to-score, clean sheets, goal-scorer chances, fair odds (decimal, fractional, American), value vs the bookmaker and bookmaker margin, scenarios, and an 11-stat comparison.
- **Track record:** add final scores to see your hit rate.
- **Responsible gambling:** 18+ age gate, clear "estimates, not guarantees" wording, and the NRGP helpline 0800 006 008.

## Free vs Pro
| | Free | Pro |
|---|---|---|
| Predictions | 2 a week | Unlimited (fair use 10/day) |
| Chances, pick, preview, key factors | ✓ | ✓ |
| Stats, team news, every scoreline, goal lines | – | ✓ |
| Scorer chances, fair odds & value, scenarios | – | ✓ |

**Prices:** R89.99/month, or R749.99/year (about R62.50/month) with a 3-day free trial.

**Testing:** the test APK has **Profile → Turn on Pro for testing**. The Play Store bundle (`FusionPredict-PlayStore.aab`) doesn't.

**Google Play Console** (Monetise → Subscriptions): Product ID `fusionpredict_pro`; base plans `monthly` (R89.99) and `yearly` (R749.99); on `yearly`, add a 3-day free-trial offer for new customers.

## AI setup
1. Create an API key at console.anthropic.com and add credit. Web search must be enabled for your organisation.
2. In the app: **Profile → AI connection**, paste the key, and tap **Test connection**.

Each prediction uses about 5–8 web searches plus AI processing, so expect roughly R2–R4 per prediction at current API prices. Reading a screenshot costs much less.

**Before launch:** deploy `server/predict-worker.js` (Cloudflare Worker, with steps in the file) and set `DEFAULT_SERVER_URL` in `app.js`, so the key isn't in the app. Caching predictions per match on the server would cut costs a lot when many users predict the same game.

## Building
GitHub Actions builds both files on every push and publishes them on the Releases page:
- `FusionPredict.apk`: the test app for your phone
- `FusionPredict-PlayStore.aab`: upload to Google Play Console

Test builds use a fixed test signing key (`app/fusionpredict-test.jks`). Before publishing, create a private upload key.

## Google Play notes
Rate the app 18+, and complete the Data safety form (screenshots are sent to the AI service). Fusion Predict gives information and analysis only. It doesn't take bets or link to betting accounts, so it isn't a real-money gambling app. It does need the content rating and policy declarations about gambling-related content.
