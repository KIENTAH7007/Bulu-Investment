// Implements the two-tier buy criteria agreed for each holding type.
// Each evaluator returns { tier1: bool, tier2: bool, reason1, reason2, purchaseType }
// purchaseType is "dca" or "lumpsum" -- used to label the Telegram alert.

export function movingAverage(priceHistory, period) {
  if (!priceHistory || priceHistory.length < period) return null;
  const recent = priceHistory.slice(-period);
  const sum = recent.reduce((s, p) => s + p.close, 0);
  return sum / recent.length;
}

export function maSlopeUp(priceHistory, period) {
  // Compares the MA computed today vs. the MA computed `period/4` days ago
  // (a quarter of the window) -- a simple, noise-resistant slope check.
  if (!priceHistory || priceHistory.length < period + Math.floor(period / 4)) return null;
  const lookback = Math.floor(period / 4);
  const maNow = movingAverage(priceHistory, period);
  const maBefore = movingAverage(priceHistory.slice(0, priceHistory.length - lookback), period);
  if (maNow === null || maBefore === null) return null;
  return maNow >= maBefore;
}

export function avgOfLastN(values, n) {
  if (!values || values.length === 0) return null;
  const recent = values.slice(-n);
  return recent.reduce((s, v) => s + v, 0) / recent.length;
}

// G3B-style: continuous DCA (tier 1, always fires on schedule) + bonus dip vs long MA (tier 2)
export function evaluateIndexDca(holding, { isDcaDay }) {
  const { price, priceHistory, criteria } = holding;
  const ma = movingAverage(priceHistory, criteria.maPeriod);
  const dipPct = ma ? ((ma - price) / ma) * 100 : null;
  const tier1 = !!isDcaDay;
  const tier2 = ma !== null && dipPct >= criteria.bonusDipPct;
  return {
    tier1, tier2,
    reason1: tier1 ? "Scheduled DCA date reached" : null,
    reason2: tier2 ? `Price ${dipPct.toFixed(1)}% below its ${criteria.maPeriod}-day average ($${ma.toFixed(2)})` : null,
    purchaseType: tier1 ? "dca" : "lumpsum",
  };
}

// CLR-style REIT: yield above its own trailing-N-quarter average (tier 1) +
// price also below its shorter MA as confirmation (tier 2)
// Days after a confirmed ex-date to hold off firing -- the price typically drops
// ~the dividend amount ON the ex-date, which mechanically spikes trailing yield
// even though nothing about the REIT's actual value changed. Waiting lets that
// settle before trusting the yield signal as real.
const EX_DATE_COOLDOWN_DAYS = 10;

export function evaluateReit(holding) {
  const { price, priceHistory, yieldHistory, criteria, lastExDate } = holding;
  const yieldValues = (yieldHistory || []).map((y) => (typeof y === "number" ? y : y.yield));
  const avgYield = avgOfLastN(yieldValues, criteria.yieldLookbackQuarters);
  const currentYield = yieldValues.length ? yieldValues[yieldValues.length - 1] : null;
  const ma = movingAverage(priceHistory, criteria.maPeriod);
  // Trend slope can no longer reliably distinguish "cheap from sentiment" (fine to buy)
  // from "cheap from real deterioration" (a value trap) -- both can look identical on a
  // price chart. So this is now a flagged note for a manual fundamentals check, not a
  // silent veto on the gate itself. See the Buy Criteria tab workflow note.
  const trendWeak = maSlopeUp(priceHistory, criteria.maPeriod) === false;

  let inCooldown = false;
  let cooldownDaysLeft = 0;
  if (lastExDate) {
    const daysSince = Math.floor((new Date() - new Date(lastExDate)) / 86400000);
    if (daysSince >= 0 && daysSince < EX_DATE_COOLDOWN_DAYS) {
      inCooldown = true;
      cooldownDaysLeft = EX_DATE_COOLDOWN_DAYS - daysSince;
    }
  }

  const yieldGateMet = avgYield !== null && currentYield !== null && currentYield > avgYield;
  const tier1 = yieldGateMet && !inCooldown;
  const tier2 = tier1 && ma !== null && price < ma;
  const trendNote = trendWeak ? " -- trend soft, ask Claude to check fundamentals before buying" : "";

  return {
    tier1, tier2, trendWeak,
    reason1: inCooldown
      ? `Yield gate would be met, but holding off ${cooldownDaysLeft} more day(s) -- within ${EX_DATE_COOLDOWN_DAYS} days of ex-date (${lastExDate}), likely a mechanical price adjustment rather than genuine value`
      : (tier1 ? `Yield ${currentYield.toFixed(2)}% above ${criteria.yieldLookbackQuarters}-quarter average ${avgYield.toFixed(2)}%${trendNote}` : null),
    reason2: tier2 ? `Also below its ${criteria.maPeriod}-day average ($${ma.toFixed(2)}) -- stronger confirmation${trendNote}` : null,
    purchaseType: "lumpsum",
  };
}

// Bank-style: P/B below its own N-year average (tier 1), into the cheap band (tier 2)
// pbHistoricalAvg / pbHistoricalBandLow live in holding.criteria -- these come from research
// (P/B needs book value + multi-year history, not something a free feed provides), refreshed
// periodically by Claude during check-ins or manually. bookValuePerShare updates quarterly with
// earnings, so P/B itself still recomputes live off the daily price.
export function evaluateBankPb(holding) {
  const { price, bookValuePerShare, priceHistory, criteria } = holding;
  const { pbHistoricalAvg, pbHistoricalBandLow } = criteria;
  if (!bookValuePerShare) return { tier1: false, tier2: false, reason1: null, reason2: null, purchaseType: "lumpsum", trendWeak: false };
  const pb = price / bookValuePerShare;
  // Same reasoning as evaluateReit above -- trend slope downgraded to an informational flag,
  // not a gate, since it can't reliably tell sentiment-driven cheap from a real value trap.
  const trendWeak = maSlopeUp(priceHistory, 200) === false;

  const tier1 = pbHistoricalAvg != null && pb < pbHistoricalAvg;
  const tier2 = tier1 && pbHistoricalBandLow != null && pb <= pbHistoricalBandLow;
  const trendNote = trendWeak ? " -- trend soft, ask Claude to check fundamentals before buying" : "";

  return {
    tier1, tier2, trendWeak,
    reason1: tier1 ? `P/B ${pb.toFixed(2)}x below its ${criteria.pbLookbackYears}-year median ${pbHistoricalAvg.toFixed(2)}x${trendNote}` : null,
    reason2: tier2 ? `P/B has dropped into the historically cheap band (<= ${pbHistoricalBandLow.toFixed(2)}x)${trendNote}` : null,
    purchaseType: "lumpsum",
    pb,
  };
}

// RSI is intentionally NOT a gate -- computed only to enrich an alert message
// that's already firing for other reasons (see README: "timing nudge, not a gate").
export function rsi(priceHistory, period = 14) {
  if (!priceHistory || priceHistory.length < period + 1) return null;
  const closes = priceHistory.slice(-(period + 1)).map((p) => p.close);
  let gains = 0, losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
