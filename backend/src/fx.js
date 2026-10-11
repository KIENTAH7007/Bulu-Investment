import { sendTelegramMessage } from "./telegram.js";

/**
 * SGD -> MYR monitoring.
 *
 * Pulls the daily SGD/MYR reference rate from Frankfurter (free, no API key,
 * daily series incl. weekends) and alerts when today's rate is meaningfully
 * ABOVE its own recent average, i.e. SGD is unusually strong against MYR and
 * it's a good moment to convert extra.
 *
 * Why a market reference rate and not Wise/YouBiz directly: YouBiz only shows
 * its rate inside the app (no public page/API), and Wise's rate API needs an
 * API token. Both price off (roughly) the mid-market rate, so "is the market
 * rate high vs its own history" is the same signal for either. The alert only
 * says WHEN to look -- the final MYR amount should still be compared in the two apps.
 *
 * Calibrated on 2 years of real data (Oct 2024 - Oct 2026): a +1.0% line vs
 * the trailing 90-day average was above water ~12% of days. Everything is
 * stored under data.fx so no other part of the data model changes.
 *
 * Everything here is defensive on purpose: a broken feed must produce a
 * Journal warning, never a silent miss (that's what bit us with dividends.sg)
 * and never an exception that could break the portfolio check-in.
 */

const FRANKFURTER = "https://api.frankfurter.dev/v2/rates";
const PLAUSIBLE_MIN = 2.5; // SGD/MYR has lived roughly 2.7-3.4 for years; far outside = bad data
const PLAUSIBLE_MAX = 4.0;
const MAX_ONE_DAY_JUMP_PCT = 3; // a >3% one-day move is far more likely a data glitch than real
const STALE_AFTER_DAYS = 3; // newest data point older than this = feed is stuck
const MIN_POINTS_FOR_AVG = 60; // need at least this many days in the window to trust an average
const HISTORY_KEEP = 800; // ~2 years of daily points
const BACKFILL_DAYS = 730; // first run
const REFRESH_DAYS = 120; // every later run re-pulls this much, so any gap or lost write self-heals

export const FX_DEFAULT_SETTINGS = {
  thresholdPct: 1.0, // alert when rate is this % above its trailing average
  monthlySpendMYR: 7000, // used only for the suggested amount in the alert text
  monthsToConvert: 3,
  windowDays: 90,
  reminderEveryDays: 3, // while still above the line
  rearmAfterDaysBelow: 7, // need this many consecutive days below the line before a NEW alert can fire
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso, n) {
  return new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
}

/** Creates/normalises data.fx in place and returns it. Safe on data that has no fx yet. */
export function ensureFx(data) {
  const prev = data.fx || {};
  const settings = { ...FX_DEFAULT_SETTINGS, ...(prev.settings || {}) };
  // guard against a cleared/zero field in the UI turning into an always-on alert
  if (!(settings.thresholdPct >= 0.2)) settings.thresholdPct = FX_DEFAULT_SETTINGS.thresholdPct;
  if (!(settings.windowDays >= 30)) settings.windowDays = FX_DEFAULT_SETTINGS.windowDays;
  data.fx = {
    history: Array.isArray(prev.history) ? prev.history : [],
    latest: prev.latest || null,
    alertState: { active: false, lastAlertDate: null, ...(prev.alertState || {}) },
    warned: prev.warned || {},
    updatedAt: prev.updatedAt || null,
    settings,
  };
  return data.fx;
}

function parseSeries(raw) {
  let rows = [];
  if (Array.isArray(raw)) {
    rows = raw.map((r) => ({ date: r.date, rate: r.rate ?? (r.rates && r.rates.MYR) ?? r.MYR }));
  } else if (raw && raw.rates && typeof raw.rates === "object") {
    rows = Object.entries(raw.rates).map(([date, v]) => ({ date, rate: typeof v === "number" ? v : v && v.MYR }));
  }
  return rows
    .map((r) => ({ date: r.date, rate: Number(r.rate) }))
    .filter((r) => typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.rate));
}

/** Returns an array of {date, rate} (possibly empty), or null on a hard fetch failure. */
async function fetchSeries(from, to) {
  try {
    const url = `${FRANKFURTER}?from=${from}&to=${to}&base=SGD&quotes=MYR`;
    const res = await fetch(url, { headers: { "User-Agent": "KT-Investment-Monitor" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.warn(`[FX] Frankfurter returned HTTP ${res.status}`);
      return null;
    }
    return parseSeries(await res.json());
  } catch (e) {
    console.warn(`[FX] Frankfurter fetch failed: ${e.message}`);
    return null;
  }
}

/** Average of the `windowDays` calendar days BEFORE history[idx] (excludes the day itself). */
function windowStats(history, idx, windowDays) {
  const startDate = addDays(history[idx].date, -windowDays);
  const vals = [];
  for (let i = idx - 1; i >= 0 && history[i].date >= startDate; i--) vals.push(history[i].rate);
  if (vals.length < MIN_POINTS_FOR_AVG) return null;
  return { avg: vals.reduce((s, v) => s + v, 0) / vals.length, vals };
}

function deviationAt(history, idx, windowDays) {
  const w = windowStats(history, idx, windowDays);
  if (!w) return null;
  return (history[idx].rate / w.avg - 1) * 100;
}

export function computeMetrics(history, settings) {
  if (!history.length) return null;
  const idx = history.length - 1;
  const w = windowStats(history, idx, settings.windowDays);
  const base = { date: history[idx].date, rate: history[idx].rate };
  if (!w) return { ...base, avg: null, deviationPct: null, percentile: null, points: history.length };
  const rate = history[idx].rate;
  return {
    ...base,
    avg: w.avg,
    deviationPct: (rate / w.avg - 1) * 100,
    percentile: Math.round((w.vals.filter((v) => v <= rate).length / w.vals.length) * 100),
    points: history.length,
  };
}

/** How many of the most recent days in a row were below the alert line (each day vs ITS OWN trailing average). */
function consecutiveDaysBelow(history, settings) {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && n <= settings.rearmAfterDaysBelow; i--) {
    const dev = deviationAt(history, i, settings.windowDays);
    if (dev === null || dev >= settings.thresholdPct) break;
    n++;
  }
  return n;
}

function warnOnce(fx, key, journal, data, text) {
  const today = todayISO();
  if (fx.warned[key] === today) return; // at most one journal line per kind per day, even if check-in runs several times
  fx.warned[key] = today;
  journal(data, text);
}

function buildMessage(kind, m, s) {
  const head = kind === "reminder" ? "SGD/MYR still above its average (reminder)" : "SGD/MYR is above its average";
  const l1 = `1 SGD = ${m.rate.toFixed(4)} MYR, ${m.deviationPct.toFixed(2)}% above its ${s.windowDays}-day average (${m.avg.toFixed(4)}). Better than ${m.percentile}% of the last ${s.windowDays} days.`;
  let l2 = "";
  if (s.monthsToConvert > 0 && s.monthlySpendMYR > 0) {
    const myr = Math.round(s.monthsToConvert * s.monthlySpendMYR);
    const sgd = Math.round(myr / m.rate / 100) * 100;
    l2 = `Suggested: consider converting about S$${sgd.toLocaleString("en-SG")} (about RM${myr.toLocaleString("en-SG")}, ${s.monthsToConvert} months of spending) instead of your usual top-up.`;
  }
  const l3 = "Compare the final MYR amount in Wise and YouBiz before sending.";
  const lines = [l1, l2, l3].filter(Boolean);
  return {
    plain: `💱 ${head}\n${lines.join("\n")}`,
    html: `💱 <b>${head}</b>\n${lines.join("\n")}`,
  };
}

function annotateDelivery(plain, sendResult) {
  if (sendResult && sendResult.ok) return plain;
  if (sendResult && sendResult.skipped) return `${plain}\n⚠️ Telegram not configured -- alert NOT sent`;
  return `${plain}\n⚠️ Telegram send FAILED -- check Railway logs`;
}

/**
 * Refreshes data.fx in place. `journal(data, text)` is the same Journal helper checkin.js uses.
 * Returns { alertsFired: [{ticker, tier, telegramSent}] } in the same shape the portfolio alerts use.
 */
export async function refreshFx(data, journal) {
  const out = { alertsFired: [] };
  const fx = ensureFx(data);
  const s = fx.settings;
  const today = todayISO();

  const needBackfill = fx.history.length < 100;
  const series = await fetchSeries(addDays(today, -(needBackfill ? BACKFILL_DAYS : REFRESH_DAYS)), today);

  if (series === null) {
    warnOnce(fx, "fetch", journal, data, "⚠️ SGD/MYR: rate fetch failed this check-in (network or Frankfurter issue) -- no FX alert evaluated.");
    return out;
  }
  if (series.length === 0) {
    warnOnce(fx, "empty", journal, data, "⚠️ SGD/MYR: Frankfurter responded but returned no usable rates -- its response format may have changed. No FX alert evaluated.");
    return out;
  }

  const clean = series.filter((p) => p.rate >= PLAUSIBLE_MIN && p.rate <= PLAUSIBLE_MAX);
  if (clean.length < series.length) {
    warnOnce(fx, "implausible", journal, data, `⚠️ SGD/MYR: ${series.length - clean.length} fetched rate(s) were outside the plausible ${PLAUSIBLE_MIN}-${PLAUSIBLE_MAX} range and were ignored.`);
  }
  if (clean.length === 0) return out;

  // Merge by date (fresh data wins), keep ascending order, trim to ~2 years.
  const byDate = new Map(fx.history.map((p) => [p.date, p.rate]));
  for (const p of clean) byDate.set(p.date, p.rate);
  fx.history = [...byDate.entries()]
    .map(([date, rate]) => ({ date, rate }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-HISTORY_KEEP);
  fx.updatedAt = today;

  const metrics = computeMetrics(fx.history, s);
  fx.latest = metrics;

  // Stale feed: don't alert on old data.
  if (daysBetween(today, metrics.date) > STALE_AFTER_DAYS) {
    warnOnce(fx, "stale", journal, data, `⚠️ SGD/MYR: newest rate is from ${metrics.date} (more than ${STALE_AFTER_DAYS} days old) -- the feed looks stuck, so no FX alert evaluated.`);
    return out;
  }
  if (metrics.deviationPct === null) return out; // not enough history in the window yet

  // Suspicious one-day jump: more likely bad data than real. Skip alerting this run only.
  const prev = fx.history[fx.history.length - 2];
  if (prev && Math.abs((metrics.rate / prev.rate - 1) * 100) > MAX_ONE_DAY_JUMP_PCT) {
    warnOnce(fx, "jump", journal, data, `⚠️ SGD/MYR: rate moved more than ${MAX_ONE_DAY_JUMP_PCT}% in one day (${prev.rate.toFixed(4)} → ${metrics.rate.toFixed(4)}) -- unusual, so no FX alert evaluated this run.`);
    return out;
  }

  const st = fx.alertState;
  const above = metrics.deviationPct >= s.thresholdPct;

  if (above) {
    let kind = null;
    if (!st.active) kind = "new";
    else if (!st.lastAlertDate || daysBetween(today, st.lastAlertDate) >= s.reminderEveryDays) kind = "reminder";
    if (kind) {
      const { plain, html } = buildMessage(kind, metrics, s);
      const sendResult = await sendTelegramMessage(html);
      journal(data, annotateDelivery(plain, sendResult));
      out.alertsFired.push({ ticker: "SGD/MYR", tier: 1, telegramSent: !!(sendResult && sendResult.ok) });
      // Only a DELIVERED message counts, so a failed send keeps retrying instead of going quiet.
      if (sendResult && sendResult.ok) {
        st.active = true;
        st.lastAlertDate = today;
      }
    }
  } else if (st.active && consecutiveDaysBelow(fx.history, s) >= s.rearmAfterDaysBelow) {
    st.active = false; // below the line long enough -- the next crossing is a fresh alert
    st.lastAlertDate = null;
  }

  return out;
}
