/**
 * Research-driven inputs and data hygiene helpers used by the check-in.
 */

// ---------------------------------------------------------------------------------------
// Bank P/B research inputs.
// These can't come from a free price feed (they need book value + multi-year valuation
// history), so they are researched and recorded here with their source. Bump `version`
// whenever the numbers are re-researched (e.g. after quarterly results) -- the next check-in
// applies the new set once and resets the "inputs are stale" reminder.
// ---------------------------------------------------------------------------------------
export const PB_RESEARCH = {
  version: "2026-10-13",
  asOfLabel: "Oct 2026",
  note: "Book value: latest reported (Jun 2026 quarter). Typical P/B: 10-year median. Cheap band: midway between that median and the 10-year low. Source: GuruFocus (SGX:D05, SGX:U11).",
  tickers: {
    D05: { bookValuePerShare: 24.67, pbHistoricalAvg: 1.49, pbHistoricalBandLow: 1.19, pbLookbackYears: 10 }, // 10y: min 0.89 / median 1.49 / max 3.24
    U11: { bookValuePerShare: 29.99, pbHistoricalAvg: 1.21, pbHistoricalBandLow: 1.03, pbLookbackYears: 10 }, // 10y: min 0.84 / median 1.21 / max 1.51
  },
};

/** Applies PB_RESEARCH to bank holdings once per version. Returns the tickers that were updated. */
export function applyPbResearch(data, journal, todayISO) {
  const updated = [];
  for (const h of data.holdings || []) {
    const r = PB_RESEARCH.tickers[h.id];
    if (!r || h.criteria?.type !== "bank-pb") continue;
    if (h.criteria.pbResearchVersion === PB_RESEARCH.version) continue;
    h.bookValuePerShare = r.bookValuePerShare;
    h.criteria = {
      ...h.criteria,
      pbHistoricalAvg: r.pbHistoricalAvg,
      pbHistoricalBandLow: r.pbHistoricalBandLow,
      pbLookbackYears: r.pbLookbackYears,
      pbUpdatedAt: todayISO,
      pbResearchVersion: PB_RESEARCH.version,
    };
    updated.push(h.id);
    journal(data, `📚 ${h.id}: P/B inputs refreshed (${PB_RESEARCH.asOfLabel}) -- book value S$${r.bookValuePerShare}, typical P/B ${r.pbHistoricalAvg}x (${r.pbLookbackYears}-yr median), cheap band ${r.pbHistoricalBandLow}x. Replaces the old placeholder numbers.`);
  }
  return updated;
}

// ---------------------------------------------------------------------------------------
// Yield-history hygiene.
// A single bad snapshot (e.g. one recorded while the dividend figure was wrong) shows up as a
// sharp dip/spike between two normal neighbours, and drags the N-point average that the CLR
// Tier 1 test compares against. Remove ONLY isolated outliers: a point >25% away from the
// midpoint of its two neighbours, where those neighbours agree with each other within 10%.
// A genuine step change (a real dividend cut) is never isolated, so it is kept.
// ---------------------------------------------------------------------------------------
export function cleanYieldHistory(holding) {
  const h = holding.yieldHistory;
  if (!Array.isArray(h) || h.length < 3) return [];
  const val = (p) => (typeof p === "number" ? p : p && p.yield);
  const drop = new Set();
  for (let i = 1; i < h.length - 1; i++) {
    const a = val(h[i - 1]), b = val(h[i]), c = val(h[i + 1]);
    if (![a, b, c].every((x) => typeof x === "number" && isFinite(x)) || a <= 0 || c <= 0) continue;
    const neighboursAgree = Math.abs(a - c) / Math.max(a, c) <= 0.10;
    const mid = (a + c) / 2;
    if (neighboursAgree && Math.abs(b - mid) / mid > 0.25) drop.add(i);
  }
  if (drop.size === 0) return [];
  const removed = [...drop].map((i) => h[i]);
  holding.yieldHistory = h.filter((_, i) => !drop.has(i));
  return removed;
}
