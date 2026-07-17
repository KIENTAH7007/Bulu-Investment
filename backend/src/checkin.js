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
  const grouped = result ? groupByPayDate(result.rows) : [];

  if (result && result.ttmYield !== null) {
    holding.yieldHistory = [...(holding.yieldHistory || []), result.ttmYield].slice(-40);
  }

  const today = todayISO();
  const futureGrouped = grouped.filter((g) => g.payDate >= today);
  const pastGrouped = grouped.filter((g) => g.payDate < today).sort((a, b) => b.payDate.localeCompare(a.payDate));

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

  // No confirmed or existing estimated upcoming entry? Generate one from last year's same
  // distribution (ex/pay date + 1 year, same per-share amount as a placeholder) -- this is
  // the "fill it in automatically, I'll revise when needed" behavior.
  const hasUpcoming = data.dividendCalendar.some((c) => c.id === holding.id && c.payDate >= today);
  if (!hasUpcoming && pastGrouped.length > 0) {
    const last = pastGrouped[0];
    const nextEx = addOneYear(last.exDate);
    const nextPay = addOneYear(last.payDate);
    data.dividendCalendar.push({
      uid: `est-${holding.id}-${nextEx}`, id: holding.id, exDate: nextEx, payDate: nextPay,
      perShare: last.amount, estimated: true, source: `pattern estimate from ${last.exDate}`,
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
  let text = `${icon} <b>${ticker}</b> \u2014 ${label}\n${reason}`;
  if (result.purchaseType === "lumpsum" && rsiValue !== null) {
    text += `\nRSI ${rsiValue.toFixed(0)}${rsiValue < 40 ? " (mildly oversold, adds confidence)" : ""}`;
  }
  return text;
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

    let result;
    if (holding.criteria.type === "index-dca") result = evaluateIndexDca(holding, { isDcaDay: isDcaDay(data) });
    else if (holding.criteria.type === "reit") result = evaluateReit(holding);
    else if (holding.criteria.type === "bank-pb") result = evaluateBankPb(holding);
    else continue;

    const rsiValue = rsi(holding.priceHistory);
    const prevState = holding.alertState || { tier1: false, tier2: false };

    // Only fire when a condition transitions from false -> true (avoid duplicate spam every check-in)
    if (result.tier1 && !prevState.tier1) {
      const text = buildAlertText(holding.id, 1, result, holding, rsiValue);
      await sendTelegramMessage(text);
      data.alertLog.unshift({ date: todayISO(), text });
      alertsFired.push({ ticker: holding.id, tier: 1 });
    }
    if (result.tier2 && !prevState.tier2) {
      const text = buildAlertText(holding.id, 2, result, holding, rsiValue);
      await sendTelegramMessage(text);
      data.alertLog.unshift({ date: todayISO(), text });
      alertsFired.push({ ticker: holding.id, tier: 2 });
    }
    holding.alertState = { tier1: result.tier1, tier2: result.tier2 };
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
