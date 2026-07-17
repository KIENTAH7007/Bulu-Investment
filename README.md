# KT Investment Monitoring App

Backend (Node/Express) + frontend (React/Vite) + twice-daily automated
check-in that evaluates the Phase 2 buy criteria and sends Telegram alerts.
No AI features yet -- those get added once the Anthropic API key is ready.

## What's already tested locally (in the build sandbox)
- Backend boots, serves the API, and serves the built frontend correctly
- Data store read/write cycle works
- Criteria logic (`criteria.js`) verified against mock price/yield data --
  tier1/tier2 gating, moving averages, RSI all compute correctly

## What could NOT be tested here (needs your Railway environment)
The sandbox this was built in only allows network access to a small
allowlist (npm, GitHub) -- it cannot reach Yahoo Finance or dividends.sg.
So the following are implemented based on the real page structure I
inspected, but need a live test after deploy:
- `priceFeed.js` -- Yahoo Finance's unofficial chart endpoint
  (`query1.finance.yahoo.com/v8/finance/chart/{TICKER}.SI`). Well-known,
  commonly used, but unofficial -- Yahoo could change it without notice.
- `dividendsSg.js` -- scrapes the dividend table on dividends.sg. I fetched
  the actual CLR page and built the parser against its real table structure,
  but I only saw the rendered content, not raw HTML tag-by-tag, so the
  `td` indexing might need a small adjustment if it doesn't parse cleanly.
- Telegram sending -- implemented per the standard Bot API, untested live
  since it needs your real token.

**After deploying, run `POST /api/checkin` manually (see Testing below) and
check the logs before trusting the scheduled runs.**

## One-time setup

### 1. Railway
- Create a new project (or reuse your existing account/project space)
- Add a **Volume**, mount it at `/data` -- this is what makes portfolio
  data survive redeploys
- Connect the GitHub repo, Railway will pick up `railway.toml` automatically

### 2. Environment variables (Railway → Variables tab)
Copy from `.env.example`:
- `DATA_DIR=/data` (must match the volume mount path)
- `TELEGRAM_BOT_TOKEN` -- from your @BotFather bot
- `TELEGRAM_CHAT_ID` -- your chat id
- `ANTHROPIC_API_KEY` -- leave blank for now

### 3. Push to GitHub
```
git init
git add -A
git commit -m "Initial build: backend, frontend, Phase 2 criteria engine"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```
Railway will build and deploy automatically once connected to the repo.

## Local development (optional, to test before pushing)
```
cd backend && npm install
cd ../frontend && npm install && npm run build
cd ../backend && DATA_DIR=./data npm start
```
Visit `http://localhost:3000`.

## Testing after deploy
1. Open the deployed URL -- dashboard should load with the seeded data
   (CLR/G3B/U11/D05 holdings, same numbers you've been reviewing in chat)
2. Trigger a manual check-in to test the whole pipeline in one shot:
   ```
   curl -X POST https://<your-app>.up.railway.app/api/checkin
   ```
3. Check Railway's logs for that request -- you should see price fetch
   results, any dividends.sg matches, and criteria evaluation output
4. If Telegram is configured correctly, a message should arrive if any
   criteria happened to be met (unlikely on the very first run since
   `alertState` starts at false -> only fires on a false-to-true
   transition, by design, to avoid duplicate spam)
5. Check the dashboard again -- price and `priceHistory` should now be
   populated for each holding (2 years backfilled on first run)

## What's not built yet (future patches)
- AI advisor / dividend safety-read buttons (waiting on API key)
- G3B's DCA schedule is currently hardcoded to "1st of the month" in
  `checkin.js` (`isDcaDay`) -- tell me your actual preferred cadence and
  I'll patch it
- `pbHistoricalAvg` / `pbHistoricalBandLow` for U11/D05 are placeholder
  estimates from our chat research -- worth verifying against real 5-year
  P/B data before the criteria are fully trusted live
- `bookValuePerShare` for U11/D05 needs a manual refresh each quarter
  after earnings (not automated -- book value doesn't move daily, so this
  is intentionally not scraped)

## Patch workflow (same as Pawvy)
I'll send you the changed files; apply with:
```
git add -A
git commit -m "Patch N: ..."
git push origin main
```
Railway redeploys automatically on push.
