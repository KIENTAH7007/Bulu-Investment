import { loadData, saveData } from "./store.js";
import { fetchLatestPrice, fetchHistory } from "./priceFeed.js";
import { fetchDividendsSg, groupByPayDate } from "./dividendsSg.js";
import { evaluateIndexDca, evaluateReit, evaluateBankPb, rsi } from "./criteria.js";
import { sendTelegramMessage } from "./telegram.js";

const TICKER_ICON = { CLR: "\ud83d\udcb0", G3B: "\ud83d\udcc8", U11: "\ud83c\udfe6", D05: "\ud83c\udfe6" };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function appendPricePoint(priceHistory, date, close) {
  const filtered = (priceHistory || []).filter((p) => p.date !== date);
  return [...filtered, { date, close }].sort((a, b) => a.date.localeCompare(b.date));
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
  } else if (result.ttmYield === null) {
    console.warn(`[${holding.id}] dividends.sg fetched OK but TTM yield text wasn't found on the page -- site markup may have changed`);
  } else {
    console.log(`[${holding.id}] TTM yield scraped: ${result.ttmYield}%`);
  }
  const grouped = result ? groupByPayDate(result.rows) : [];

  if (result && result.ttmYield !== null) {
    holding.yieldHistory = [...(holding.yieldHistory || []).filter((y) => y.date !== todayISO()), { date: todayISO(), yield: result.ttmYield }].slice(-100);
  }

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

  // Auto-update Ann. div/share from real trailing-12-month confirmed distributions --
  // this is what was missing before: the scraper found real numbers but nothing ever
  // wrote them into the field the app actually displays and calculates yield from.
  const oneYearAgo = new Date(); oneYearAgo.setDate(oneYearAgo.getDate() - 365);
  const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10);
  const trailing12mo = grouped
    .filter((g) => g.payDate >= oneYearAgoStr && g.payDate <= today)
    .reduce((s, g) => s + g.amount, 0);
  if (trailing12mo > 0) {
    const rounded = Math.round(trailing12mo * 10000) / 10000;
    if (rounded !== holding.annualDiv) {
      console.log(`[${holding.id}] Ann. div/share updated: ${holding.annualDiv} -> ${rounded} (trailing 12mo from dividends.sg)`);
      holding.annualDiv = rounded;
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
      data.alertLog.unshift({ date: today, text: `Confirmed dividend found for ${holding.id}: ex ${div.exDate}, pay ${div.payDate}, $${div.amount}/share` });
    }
  }

  // No confirmed or existing estimated upcoming entry? Estimate one from history.
  // Important: don't just take the single most-recent past entry and add a year --
  // for a semi-annual/quarterly payer, "most recent past" might be the WRONG half of
  // the cycle depending on where today falls (e.g. today is Jul, most recent past is
  // Jan -> naive +1yr gives next Jan, skipping right over the correct upcoming Jul
  // date). Instead: project every past entry forward by exactly 1 year, keep only the
  // ones that land in the future, and take the earliest of those.
  //
  // Only a CONFIRMED entry blocks re-estimation. An existing *estimated* entry gets
  // recalculated fresh every check-in -- otherwise a wrong estimate (e.g. from a
  // scraper bug that's since been fixed) would stay stuck forever, since "there's
  // already an upcoming entry" would look satisfied even though it's wrong.
  const hasConfirmedUpcoming = data.dividendCalendar.some((c) => c.id === holding.id && c.payDate >= today && !c.estimated);
  if (!hasConfirmedUpcoming && pastGrouped.length > 0) {
    const candidates = pastGrouped
      .map((g) => ({ exDate: addOneYear(g.exDate), payDate: addOneYear(g.payDate), amount: g.amount }))
      .filter((c) => c.payDate >= today)
      .sort((a, b) => a.payDate.localeCompare(b.payDate));
    const best = candidates[0] || { exDate: addOneYear(pastGrouped[0].exDate), payDate: addOneYear(pastGrouped[0].payDate), amount: pastGrouped[0].amount };
    // Replace any existing (stale) estimated upcoming entry for this holding with the freshly computed one
    data.dividendCalendar = data.dividendCalendar.filter((c) => !(c.id === holding.id && c.estimated && c.payDate >= today));
    data.dividendCalendar.push({
      uid: `est-${holding.id}-${best.exDate}`, id: holding.id, exDate: best.exDate, payDate: best.payDate,
      perShare: best.amount, estimated: true, source: `pattern estimate from last year's same cycle`,
    });
  }
}

function isDcaDay(data) {
  // Placeholder DCA schedule: 1st check-in of the month. Adjust to match
  // whatever cadence you actually want to buy G3B on.
  const today = new Date();
  return today.getDate() === 1;
}

function buildAlertText(ticker, tier, result, holding, rsiValue) {
  const icon = TICKER_ICON[ticker] || "\ud83d\udd14";
  const label = result.purchaseType === "dca" ? "Scheduled DCA" : `Lump sum opportunity (Tier ${tier})`;
  const reason = tier === 1 ? result.reason1 : result.reason2;
  let plain = `${icon} ${ticker} \u2014 ${label}\n${reason}`;
  let html = `${icon} <b>${ticker}</b> \u2014 ${label}\n${reason}`;
  if (result.purchaseType === "lumpsum" && rsiValue !== null) {
    const rsiLine = `\nRSI ${rsiValue.toFixed(0)}${rsiValue < 40 ? " (mildly oversold, adds confidence)" : ""}`;
    plain += rsiLine;
    html += rsiLine;
  }
  return { plain, html };
}

function annotateDeliveryStatus(plainText, sendResult) {
  if (sendResult && sendResult.ok) return plainText; // delivered fine, no need to clutter the journal
  if (sendResult && sendResult.skipped) return `${plainText}\n\u26a0\ufe0f Telegram not configured -- alert NOT sent`;
  return `${plainText}\n\u26a0\ufe0f Telegram send FAILED -- check Railway logs`;
}

export async function runCheckin(trigger = "scheduled") {
  const data = loadData();
  const alertsFired = [];

  for (const holding of data.holdings) {
    await ensureHistory(holding);

    const priceInfo = await fetchLatestPrice(holding.id);
    if (priceInfo) {
      holding.price = priceInfo.price;
      holding.priceHistory = appendPricePoint(holding.priceHistory, priceInfo.asOf, priceInfo.price);
    }

    await refreshDividends(holding, data);

    const critType = holding.criteria?.type;
    let result = null;
    if (critType === "index-dca") result = evaluateIndexDca(holding, { isDcaDay: isDcaDay(data) });
    else if (critType === "reit") result = evaluateReit(holding);
    else if (critType === "bank-pb") result = evaluateBankPb(holding);
    if (!result) continue; // no buy-criteria set for this holding yet -- price/dividends were still refreshed above

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
        data.alertLog.unshift({ date: today, text: annotateDeliveryStatus(plain, sendResult) });
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
        data.alertLog.unshift({ date: today, text: annotateDeliveryStatus(plain, sendResult) });
        alertsFired.push({ ticker: holding.id, tier: 2, telegramSent: !!sendResult.ok });
        if (sendResult.ok) newState.tier2LastFired = today;
      }
    } else {
      newState.tier2 = false;
      newState.tier2LastFired = null;
    }
    holding.alertState = newState;
  }

  // Watchlist: just refresh price + append to history, no criteria evaluated (Phase 2 scope is core holdings only)
  for (const w of data.watchlist) {
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
