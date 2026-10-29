// Pure calculation helpers for the DCA Planner (Strategy tab). No React in here so they can be
// tested on their own. Everything is derived from the Portfolio holdings -- nothing is written back.

export const DEFAULT_PLANNER = {
  budget: 2500,        // S$ to deploy this round
  carry: 0,            // S$ left over (+) or overspent (-) from last round
  tolerancePct: 10,    // buy the next lot up if it costs no more than target + this %
  includeFees: true,   // subtract an estimated broker fee from what's left over
  lots: {},            // per-ticker lot size, default 10
  custom: { weights: {}, force: {} }, // custom split: % per ticker, optional forced share count
};
export const DEFAULT_LOT = 10;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function lotFor(settings, id) {
  const l = Math.floor(num(settings && settings.lots && settings.lots[id]));
  return l >= 1 ? l : DEFAULT_LOT;
}

/** Latest simple moving average of closes, or null if there isn't enough history. */
export function movingAvgLast(priceHistory, period) {
  if (!priceHistory || !period || priceHistory.length < period) return null;
  const recent = priceHistory.slice(-period);
  return recent.reduce((s, p) => s + p.close, 0) / recent.length;
}

/**
 * Rough SGX fee for one buy order on Moomoo SG: platform fee 0.03% (min S$0.99) + SGX trading
 * 0.0075% + SGX clearing 0.0325%, plus 9% GST. Commission is waived in the current promotion.
 * An estimate only -- the order preview in Moomoo is the real number.
 */
export function estimateFeeSGX(value, gstPct = 9) {
  if (!(value > 0)) return 0;
  const platform = Math.max(value * 0.0003, 0.99);
  const exchange = value * (0.000075 + 0.000325);
  return (platform + exchange) * (1 + gstPct / 100);
}

/** How expensive a holding looks right now, using whatever its buy criteria already track. */
export function valuationInfo(h) {
  const c = h.criteria || {};
  const price = num(h.price);
  if (c.type === "bank-pb" && num(h.bookValuePerShare) > 0 && price > 0) {
    const pb = price / h.bookValuePerShare;
    const median = c.pbHistoricalAvg != null ? num(c.pbHistoricalAvg) : null;
    const ratio = median > 0 ? pb / median : null;
    const premiumPct = ratio != null ? (ratio - 1) * 100 : null;
    let level = "none", label = "No median set";
    if (premiumPct != null) {
      if (premiumPct <= 0) { level = "green"; label = "Below its median"; }
      else if (premiumPct <= 30) { level = "amber"; label = "Above its median"; }
      else { level = "red"; label = "Expensive vs median"; }
    }
    return { kind: "pb", pb, median, bandLow: c.pbHistoricalBandLow ?? null, ratio, premiumPct, level, label };
  }
  if (c.type === "index-dca") {
    const period = c.maPeriod || 200;
    const ma = movingAvgLast(h.priceHistory, period);
    if (ma && price > 0) {
      const vsPct = (price / ma - 1) * 100;
      return { kind: "ma", ma, period, vsPct, level: vsPct <= 0 ? "green" : "amber", label: vsPct <= 0 ? `Below ${period}-day avg` : `Above ${period}-day avg` };
    }
  }
  return { kind: "none", level: "none", label: "-" };
}

/** Banks that have P/B data, best value first: lowest P/B relative to its own median. */
export function rankBanks(holdings) {
  return holdings
    .filter((h) => h.criteria && h.criteria.type === "bank-pb" && num(h.price) > 0)
    .map((h) => ({ h, v: valuationInfo(h) }))
    .filter((x) => x.v.kind === "pb" && x.v.ratio != null)
    .map((x) => ({
      id: x.h.id, ratio: x.v.ratio, premiumPct: x.v.premiumPct, pb: x.v.pb, median: x.v.median,
      yieldPct: num(x.h.annualDiv) / num(x.h.price) * 100,
    }))
    .sort((a, b) => a.ratio - b.ratio || b.yieldPct - a.yieldPct);
}

/** Plan one leg: how many shares to buy for a target amount, in lots, with the stretch rule. */
export function planLeg(h, target, lot, tolerancePct, forceShares) {
  const price = num(h.price);
  if (!(price > 0)) return { id: h.id, ok: false, reason: "No price" };
  const L = Math.max(1, Math.floor(lot) || DEFAULT_LOT);
  const lotCost = price * L;
  let shares, stretched = false, forced = false;
  const forceGiven = forceShares !== undefined && forceShares !== null && forceShares !== "";
  const below = target > 0 ? Math.floor(target / lotCost) * L : 0;
  const above = below + L;
  if (forceGiven) {
    shares = Math.max(0, Math.floor(num(forceShares)));
    forced = true;
  } else if (target > 0 && above * price <= target * (1 + num(tolerancePct) / 100)) {
    shares = above; stretched = true;
  } else {
    shares = below;
  }
  const cost = shares * price;
  const devPct = target > 0 ? (cost - target) / target * 100 : null;
  const tol = num(tolerancePct);
  // Tolerance 0 means "no stretch rule" -- then there's nothing to flag against.
  const outside = tol > 0 && !forced && target > 0 && devPct != null && Math.abs(devPct) > tol + 1e-9;
  // When the result misses the target by more than the tolerance, show the other lot count too.
  let alt = null;
  if (outside && !stretched) alt = { shares: above, cost: above * price, devPct: (above * price - target) / target * 100 };
  const oldShares = num(h.shares), oldAvg = num(h.avgCost);
  const newShares = oldShares + shares;
  const newAvg = shares > 0 ? (oldShares * oldAvg + cost) / newShares : oldAvg;
  const annualDiv = num(h.annualDiv);
  return {
    id: h.id, ok: true, price, lot: L, target, shares, cost, devPct, stretched, forced, outside, alt,
    cantAffordLot: shares === 0 && !forced && target > 0,
    lotCost, oldAvg, newAvg, monthlyAdded: shares * annualDiv / 12, annualAdded: shares * annualDiv,
  };
}

/** Plan a whole scenario (a set of weights, in %, across tickers). */
export function planScenario(holdings, weights, settings, forceMap = {}) {
  const effBudget = num(settings.budget) + num(settings.carry);
  const legs = [];
  for (const [id, w] of Object.entries(weights)) {
    const weight = num(w);
    const force = forceMap[id];
    const hasForce = force !== undefined && force !== null && force !== "";
    if (!(weight > 0) && !hasForce) continue;
    const h = holdings.find((x) => x.id === id);
    if (!h) continue;
    legs.push({ weight, ...planLeg(h, effBudget * weight / 100, lotFor(settings, id), settings.tolerancePct, force) });
  }
  const okLegs = legs.filter((l) => l.ok);
  const invested = okLegs.reduce((s, l) => s + l.cost, 0);
  const fees = settings.includeFees ? okLegs.reduce((s, l) => s + (l.shares > 0 ? estimateFeeSGX(l.cost) : 0), 0) : 0;
  const addedMonthly = okLegs.reduce((s, l) => s + l.monthlyAdded, 0);
  const addedAnnual = addedMonthly * 12;
  const incomeBefore = holdings.reduce((s, h) => s + num(h.shares) * num(h.annualDiv) / 12, 0);
  return {
    effBudget, legs, invested, fees,
    leftover: effBudget - invested - fees,
    addedMonthly, incomeBefore, incomeAfter: incomeBefore + addedMonthly,
    yieldOnNew: invested > 0 ? addedAnnual / invested * 100 : null,
  };
}

/** The preset rows. Only presets whose tickers are in the Portfolio (with a price) are offered. */
export function buildPresets(holdings) {
  const has = (id) => holdings.some((h) => h.id === id && num(h.price) > 0);
  const banks = rankBanks(holdings);
  const best = banks.length ? banks[0].id : null;
  const out = [];
  if (has("G3B") && best) out.push({ key: "auto", label: `Best-value bank: 50% G3B / 50% ${best}`, weights: { G3B: 50, [best]: 50 }, suggested: true });
  if (has("G3B")) out.push({ key: "g3b", label: "1. All G3B", weights: { G3B: 100 } });
  if (has("G3B") && has("D05")) out.push({ key: "g3b-d05", label: "2. 50% G3B / 50% D05", weights: { G3B: 50, D05: 50 } });
  if (has("G3B") && has("U11")) out.push({ key: "g3b-u11", label: "3. 50% G3B / 50% U11", weights: { G3B: 50, U11: 50 } });
  if (has("U11")) out.push({ key: "u11", label: "4a. All U11", weights: { U11: 100 } });
  if (has("U11") && has("D05")) out.push({ key: "u11-d05", label: "4b. 50% U11 / 50% D05", weights: { U11: 50, D05: 50 } });
  return out;
}
