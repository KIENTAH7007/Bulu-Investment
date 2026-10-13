import { loadData, saveData } from "./store.js";
import { fetchLatestPrice, fetchHistory } from "./priceFeed.js";
import { fetchDividendsSg, groupByPayDate } from "./dividendsSg.js";
import { evaluateIndexDca, evaluateReit, evaluateBankPb, rsi } from "./criteria.js";
import { sendTelegramMessage } from "./telegram.js";
import { refreshFx } from "./fx.js";
import { applyPbResearch, cleanYieldHistory } from "./research.js";

const TICKER_ICON = { CLR: "💰", G3B: "📈", U11: "🏦", D05: "🏦" };

// Sanity bounds on a computed Ann. div/share value, checked as an implied
// yield at current price. Catches obviously-broken scraped data (a stray
// row, a mis-parsed amount) before it ever reaches the displayed number or
// the buy-criteria gates. Outside this range for an SGX bank/REIT is not
// plausible -- reject rather than silently apply.
const PLAUSIBLE_YIELD_MIN = 0.3; // %
const PLAUSIBLE_YIELD_MAX = 15; // %
// A change this large from the previous stored value is still applied (it's
// been through the plausibility check above and the exact-duplicate dedup),
// but flagged loudly in the Journal so it doesn't slip by unnoticed -- this
// is exactly the kind of jump that started this week's investigation.
const LARGE_JUMP_PCT = 25;

// How stale bank P/B research inputs (book value, historical average/band)
// can get before we start reminding -- these are manually refreshed, not
// scraped, so nothing else will ever flag them going stale on its own.
const PB_STALE_AFTER_DAYS = 100; // roughly one quarter
const PB_REMINDER_COOLDOWN_DAYS = 30; // don't repeat the reminder every check-in

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.floor((new Date(a) - new Date(b)) / 86400000);
}

function appendPricePoint(priceHistory, date, close) {
  const filtered = (priceHistory || []).filter((p) => p.date !== date);
  return [...filtered, { date, close }].sort((a, b) => a.date.localeCompare(b.date));
}

function journal(data, text) {
  data.alertLog.unshift({ date: todayISO(), text });
}

/**
 * Backfills 2 years of daily history for a holding on its first run, so
 * moving averages are usable immediately instead of taking months to build.
 */
async function ensureHistory(holding) {
  if (holding.priceHistory && holding.priceHistory.length > 50) return holding;
  const history = await fetchHistory(holding.id, "2y");
  if (history.length) holding.priceHistory = history;
  return holding;
}

function addOneYear(isoDate) {
  const d = new Date(isoDate);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

async function refreshDividends(holding, data) {
  const result = await fetchDividendsSg(holding.id);
  if (!result) {
    console.warn(`[${holding.id}] dividends.sg fetch returned nothing -- check network/page structure`);
    journal(data, `⚠️ ${holding.id}: dividend data fetch failed this check-in (network or site issue) -- Ann. div/share and dividend calendar left unchanged.`);
  } else if (result.rows.length === 0) {
    // Fetch succeeded (page loaded) but the scraper found zero dividend rows --
    // this is what actually happened on 2026-09-22 when dividends.sg redesigned
    // its markup and the old <table> selector silently matched nothing. That
    // went unnoticed for days because only the !result branch above was
    // journaled. Flag this "soft failure" case too so it can never go silent again.
    console.warn(`[${holding.id}] dividends.sg fetch succeeded but found zero dividend rows -- site markup may have changed`);
    journal(data, `⚠️ ${holding.id}: dividends.sg page loaded fine but no dividend rows were found on it -- the site's markup may have changed again. Ann. div/share and dividend calendar left unchanged. Worth checking dividends.sg for ${holding.id} manually.`);
  }
  const grouped = result ? groupByPayDate(result.rows) : [];
  const today = todayISO();
  const futureGrouped = grouped.filter((g) => g.payDate >= today);
  const pastGrouped = grouped.filter((g) => g.payDate < today).sort((a, b) => b.payDate.localeCompare(a.payDate));

  // Track the most recent EX-date that has already occurred (independent of whether
  // its pay-date has happened yet -- the mechanical price drop happens ON the ex-date).
  // Used by evaluateReit's cooldown check to avoid mistaking that drop for genuine value.
  const exDatesOccurred = grouped.filter((g) => g.exDate <= today).map((g) => g.exDate).sort();
  if (exDatesOccurred.length > 0) {
    const mostRecentExDate = exDatesOccurred[exDatesOccurred.length - 1];
    if (!holding.lastExDate || mostRecentExDate > holding.lastExDate) {
      holding.lastExDate = mostRecentExDate;
    }
  }

  // Ann. div/share: sum confirmed pay-dates by inferred payment frequency, using
  // rows already deduplicated of exact-duplicate amounts by groupByPayDate -- see
  // dividendsSg.js for why this replaced trusting the site's own "Annual dividend
  // per unit" stat (verified wrong against real cash).
  //
  // Frequency is inferred from the AVERAGE gap across the full date span (total
  // span / number of gaps), then snapped to the nearest realistic SGX cadence
  // (1/2/4/12 per year) -- NOT the median of individual gaps. A true semi-annual
  // payer's gaps alternate between short (~100d, within-year) and long (~260d,
  // across-year); with an odd number of historical gaps the median can land on
  // the short side and misclassify it as quarterly. Confirmed on U11 (2026-09-22):
  // median-gap logic inferred 4 payments/year and silently summed 2 years' worth
  // ($3.86) instead of the correct trailing 2 payments ($1.59) -- the average/span
  // approach isn't fooled by that alternating pattern and gave the right answer
  // for both U11 (2/yr, $1.59) and CLR (2/yr, $0.045), verified against real data.
  const allPayDatesSorted = [...new Set(grouped.map((g) => g.payDate))].sort();
  let paymentsPerYear = 2; // sensible default (semi-annual) if not enough history to infer
  if (allPayDatesSorted.length >= 2) {
    const first = new Date(allPayDatesSorted[0]);
    const last = new Date(allPayDatesSorted[allPayDatesSorted.length - 1]);
    const spanDays = (last - first) / 86400000;
    const avgGap = spanDays / (allPayDatesSorted.length - 1);
    const rawPerYear = avgGap > 0 ? 365.25 / avgGap : 2;
    const buckets = [1, 2, 4, 12];
    paymentsPerYear = buckets.reduce(
      (best, b) => (Math.abs(b - rawPerYear) < Math.abs(best - rawPerYear) ? b : best),
      buckets[0]
    );
  }
  const confirmedPastPayDates = allPayDatesSorted.filter((d) => d <= today).slice(-paymentsPerYear);
  const trailingSum = grouped
    .filter((g) => confirmedPastPayDates.includes(g.payDate))
    .reduce((s, g) => s + g.amount, 0);

  if (trailingSum > 0 && confirmedPastPayDates.length === paymentsPerYear) {
    const candidate = Math.round(trailingSum * 10000) / 10000;
    const impliedYield = holding.price > 0 ? (candidate / holding.price) * 100 : null;

    if (impliedYield !== null && (impliedYield < PLAUSIBLE_YIELD_MIN || impliedYield > PLAUSIBLE_YIELD_MAX)) {
      // Fails the sanity check -- don't apply, flag it instead of silently corrupting the number.
      journal(data, `⚠️ ${holding.id}: computed Ann. div/share $${candidate} implies an implausible ${impliedYield.toFixed(1)}% yield at the current price -- REJECTED, keeping $${holding.annualDiv}. Please check dividends.sg for ${holding.id} manually.`);
    } else if (candidate !== holding.annualDiv) {
      const prev = holding.annualDiv;
      const jumpPct = prev > 0 ? Math.abs(candidate - prev) / prev * 100 : null;
      console.log(`[${holding.id}] Ann. div/share updated: ${prev} -> ${candidate} (last ${paymentsPerYear} confirmed payment(s), duplicate-row-safe sum)`);
      holding.annualDiv = candidate;
      // Event-based yield snapshot -- only recorded when the confirmed distribution
      // total actually changes (roughly once per real payment cycle), NOT once a day.
      // This is what makes "yieldLookbackQuarters" genuinely mean quarters: averaging
      // the last N of these actually spans N real distribution cycles, not N days.
      if (holding.price > 0) {
        holding.yieldHistory = [...(holding.yieldHistory || []), { date: today, yield: Math.round((candidate / holding.price) * 10000) / 100 }].slice(-40);
      }
      if (jumpPct !== null && jumpPct > LARGE_JUMP_PCT) {
        journal(data, `⚠️ ${holding.id}: Ann. div/share changed by ${jumpPct.toFixed(0)}% ($${prev} → $${candidate}). Applied (passed the plausibility check), but a change this large is worth a quick sanity check against your actual dividend statement.`);
      } else {
        journal(data, `${holding.id}: Ann. div/share updated to $${candidate} (confirmed dividends.sg data).`);
      }
    }
  }

  // Real confirmed upcoming distributions from dividends.sg -- these win over any estimate
  for (const div of futureGrouped) {
    const exists = data.dividendCalendar.some((c) => c.id === holding.id && c.exDate === div.exDate);
    if (!exists) {
      // A confirmed real date supersedes any estimate for roughly the same period
      data.dividendCalendar = data.dividendCalendar.filter(
        (c) => !(c.id === holding.id && c.estimated && Math.abs(new Date(c.payDate) - new Date(div.payDate)) < 45 * 86400000)
      );
      data.dividendCalendar.push({
        uid: `dsg-${holding.id}-${div.exDate}`, id: holding.id, exDate: div.exDate, payDate: div.payDate,
        perShare: div.amount, estimated: false, source: "dividends.sg (confirmed)",
      });
      journal(data, `Confirmed dividend found for ${holding.id}: ex ${div.exDate}, pay ${div.payDate}, $${div.amount}/share`);
    }
  }

  // No confirmed or existing estimated upcoming entry? Estimate one from history.
  // Project every past entry forward by exactly 1 year, keep only future-dated
  // results, take the earliest -- avoids picking the wrong half of a semi-annual
  // cycle depending on where "today" falls. Only a CONFIRMED entry blocks
  // re-estimation, so a stale estimate always gets recomputed fresh.
  const hasConfirmedUpcoming = data.dividendCalendar.some((c) => c.id === holding.id && c.payDate >= today && !c.estimated);
  if (!hasConfirmedUpcoming && pastGrouped.length > 0) {
    const candidates = pastGrouped
      .map((g) => ({ exDate: addOneYear(g.exDate), payDate: addOneYear(g.payDate), amount: g.amount }))
      .filter((c) => c.payDate >= today)
      .sort((a, b) => a.payDate.localeCompare(b.payDate));
    const best = candidates[0] || { exDate: addOneYear(pastGrouped[0].exDate), payDate: addOneYear(pastGrouped[0].payDate), amount: pastGrouped[0].amount };
    data.dividendCalendar = data.dividendCalendar.filter((c) => !(c.id === holding.id && c.estimated && c.payDate >= today));
    data.dividendCalendar.push({
      uid: `est-${holding.id}-${best.exDate}`, id: holding.id, exDate: best.exDate, payDate: best.payDate,
      perShare: best.amount, estimated: true, source: `pattern estimate from last year's same cycle`,
    });
  }
}

function checkPbStaleness(holding, data) {
  if (holding.criteria?.type !== "bank-pb") return;
  const today = todayISO();
  const updatedAt = holding.criteria.pbUpdatedAt;
  const isStale = !updatedAt || daysBetween(today, updatedAt) > PB_STALE_AFTER_DAYS;
  if (!isStale) return;
  const lastFlagged = holding.criteria.pbStalenessLastFlagged;
  if (lastFlagged && daysBetween(today, lastFlagged) < PB_REMINDER_COOLDOWN_DAYS) return;
  holding.criteria.pbStalenessLastFlagged = today;
  journal(data, `⚠️ ${holding.id}: P/B research inputs (book value / historical average / cheap band) ${updatedAt ? `haven't been refreshed since ${updatedAt}` : "have never been refreshed"} -- ask Claude to update them after the next quarterly results.`);
}

function isDcaDay(data) {
  // Placeholder DCA schedule: 1st check-in of the month. Adjust to match
  // whatever cadence you actually want to buy G3B on.
  const today = new Date();
  return today.getDate() === 1;
}

function buildAlertText(ticker, tier, result, holding, rsiValue) {
  const icon = TICKER_ICON[ticker] || "🔔";
  const label = result.purchaseType === "dca" ? "Scheduled DCA" : `Lump sum opportunity (Tier ${tier})`;
  const reason = tier === 1 ? result.reason1 : result.reason2;
  let plain = `${icon} ${ticker} — ${label}\n${reason}`;
  let html = `${icon} <b>${ticker}</b> — ${label}\n${reason}`;
  if (result.purchaseType === "lumpsum" && rsiValue !== null) {
    const rsiLine = `\nRSI ${rsiValue.toFixed(0)}${rsiValue < 40 ? " (mildly oversold, adds confidence)" : ""}`;
    plain += rsiLine;
    html += rsiLine;
  }
  return { plain, html };
}

function annotateDeliveryStatus(plainText, sendResult) {
  if (sendResult && sendResult.ok) return plainText; // delivered fine, no need to clutter the journal
  if (sendResult && sendResult.skipped) return `${plainText}\n⚠️ Telegram not configured -- alert NOT sent`;
  return `${plainText}\n⚠️ Telegram send FAILED -- check Railway logs`;
}

export async function runCheckin(trigger = "scheduled") {
  const data = loadData();
  const alertsFired = [];

  // Apply the researched bank P/B inputs once per research version (no-op afterwards).
  applyPbResearch(data, journal, todayISO());

  for (const holding of data.holdings) {
    await ensureHistory(holding);

    const priceInfo = await fetchLatestPrice(holding.id);
    let priceStale = false;
    if (priceInfo) {
      holding.price = priceInfo.price;
      holding.priceHistory = appendPricePoint(holding.priceHistory, priceInfo.asOf, priceInfo.price);
    } else {
      priceStale = true;
      console.warn(`[${holding.id}] price fetch failed -- keeping last known price, skipping buy-criteria evaluation this run`);
      journal(data, `⚠️ ${holding.id}: price fetch failed this check-in -- kept last known price ($${holding.price}), buy-criteria evaluation skipped for this run to avoid gating on a stale price.`);
    }

    await refreshDividends(holding, data);
    const removedYieldPoints = cleanYieldHistory(holding);
    if (removedYieldPoints.length) {
      journal(data, `🧹 ${holding.id}: removed ${removedYieldPoints.length} isolated bad point(s) from yield history (${removedYieldPoints.map((p) => `${typeof p === "number" ? p : p.yield}%${p.date ? " on " + p.date : ""}`).join(", ")}) -- they were out of line with the readings on either side and were skewing the yield average.`);
    }
    checkPbStaleness(holding, data);

    const critType = holding.criteria?.type;
    let result = null;
    if (!priceStale) {
      if (critType === "index-dca") result = evaluateIndexDca(holding, { isDcaDay: isDcaDay(data) });
      else if (critType === "reit") result = evaluateReit(holding);
      else if (critType === "bank-pb") result = evaluateBankPb(holding);
    }
    if (!result) continue; // no buy-criteria set, or evaluation skipped due to stale price -- price/dividends were still refreshed above
    holding.trendWeak = !!result.trendWeak;

    const rsiValue = rsi(holding.priceHistory);
    const prevState = holding.alertState || { tier1: false, tier2: false, tier1LastFired: null, tier2LastFired: null };
    const today = todayISO();
    const newState = { ...prevState };

    // Fires once per calendar day while a condition stays met (a daily reminder,
    // not a one-time notice) -- but a failed/skipped Telegram send doesn't count
    // as that day's reminder, so it keeps retrying same-day until it actually
    // delivers. Condition clearing resets tracking so a future re-trigger is fresh.
    if (result.tier1) {
      newState.tier1 = true;
      if (prevState.tier1LastFired !== today) {
        const { plain, html } = buildAlertText(holding.id, 1, result, holding, rsiValue);
        const sendResult = await sendTelegramMessage(html);
        journal(data, annotateDeliveryStatus(plain, sendResult));
        alertsFired.push({ ticker: holding.id, tier: 1, telegramSent: !!sendResult.ok });
        if (sendResult.ok) newState.tier1LastFired = today;
      }
    } else {
      newState.tier1 = false;
      newState.tier1LastFired = null;
    }

    if (result.tier2) {
      newState.tier2 = true;
      if (prevState.tier2LastFired !== today) {
        const { plain, html } = buildAlertText(holding.id, 2, result, holding, rsiValue);
        const sendResult = await sendTelegramMessage(html);
        journal(data, annotateDeliveryStatus(plain, sendResult));
        alertsFired.push({ ticker: holding.id, tier: 2, telegramSent: !!sendResult.ok });
        if (sendResult.ok) newState.tier2LastFired = today;
      }
    } else {
      newState.tier2 = false;
      newState.tier2LastFired = null;
    }
    holding.alertState = newState;
  }

  // SGD/MYR rate monitoring. Wrapped so a problem here can never break the
  // portfolio check-in above -- it just shows up as a Journal warning instead.
  try {
    const fxResult = await refreshFx(data, journal);
    alertsFired.push(...fxResult.alertsFired);
  } catch (e) {
    console.error("SGD/MYR check failed:", e);
    journal(data, `⚠️ SGD/MYR: check failed unexpectedly (${e.message}) -- portfolio check-in itself was unaffected.`);
  }

  // Watchlist: just refresh price + append to history, no criteria evaluated
  for (const w of data.watchlist || []) {
    const priceInfo = await fetchLatestPrice(w.id);
    if (priceInfo) {
      w.price = priceInfo.price;
      w.priceHistory = appendPricePoint(w.priceHistory, priceInfo.asOf, priceInfo.price);
    }
  }

  data.lastCheckin = { at: new Date().toISOString(), trigger, alertsFired };
  saveData(data);
  console.log(`Check-in (${trigger}) complete. Alerts fired: ${alertsFired.length}`);
  return data.lastCheckin;
}
