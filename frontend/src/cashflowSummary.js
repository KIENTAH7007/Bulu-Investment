// Month-by-month summary for the Cashflow tab: income, spending, investing, "extra cash" left over,
// and a running total. Pure maths (no React) so it can be tested on its own.
import { convert, monthsBetween, monthLabel } from "./cashflowShared.js";

export const DEFAULT_CF_SETTINGS = { openingBalance: 0, openingCurrency: "SGD", openingMonth: null, investCategories: [] };

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * One row per month from the start month up to this month (or the last month that has an entry).
 *  income   = money in
 *  spent    = money out, except categories ticked as "investing"
 *  invested = money out in the ticked investing categories
 *  extra    = income - spent - invested  (the cash that is left over, or negative if overspent)
 *  kept     = (income - spent) / income  (the share of income not spent, investing counts as kept)
 *  cumulative = opening cash + all the "extra" up to and including this month
 * Currency exchanges (transfers) are ignored, same as the Net card above.
 */
export function buildMonthly({ entries, history, cur, personOk = () => true, settings, today }) {
  const s = { ...DEFAULT_CF_SETTINGS, ...(settings || {}) };
  const inv = new Set((s.investCategories || []).map((c) => String(c).toLowerCase()));
  const thisMonth = today.slice(0, 7);

  const real = entries.filter((e) => (e.type === "in" || e.type === "out") && personOk(e));
  if (real.length === 0 && !s.openingMonth) return { rows: [], startMonth: null, opening: 0, unconverted: 0, openingMissingRate: false };

  const months = real.map((e) => e.date.slice(0, 7)).sort();
  const firstEntry = months.length ? months[0] : thisMonth;
  const startMonth = s.openingMonth || firstEntry;
  const lastEntry = months.length ? months[months.length - 1] : thisMonth;
  const endMonth = lastEntry > thisMonth ? lastEntry : thisMonth;
  const keys = startMonth <= endMonth ? monthsBetween(startMonth, endMonth) : [startMonth];

  const rows = keys.map((k) => ({ key: k, label: monthLabel(k), income: 0, spent: 0, invested: 0, count: 0, partial: k === thisMonth }));
  const idx = new Map(rows.map((r, i) => [r.key, i]));
  let unconverted = 0;
  for (const e of real) {
    const i = idx.get(e.date.slice(0, 7));
    if (i === undefined) continue; // dated before the start month
    const v = convert(e, cur, history);
    if (v === null) { unconverted++; continue; }
    rows[i].count++;
    if (e.type === "in") rows[i].income += v;
    else if (inv.has(String(e.category).toLowerCase())) rows[i].invested += v;
    else rows[i].spent += v;
  }

  let openingMissingRate = false;
  let opening = 0;
  if (s.openingBalance) {
    const v = convert({ currency: s.openingCurrency, amount: s.openingBalance, date: startMonth + "-01" }, cur, history);
    if (v === null) openingMissingRate = true; else opening = v;
  }

  let running = opening;
  const out = rows.map((r) => {
    const extra = r.income - r.spent - r.invested;
    running += extra;
    return {
      ...r,
      income: r2(r.income), spent: r2(r.spent), invested: r2(r.invested),
      extra: r2(extra),
      kept: r.income > 0 ? ((r.income - r.spent) / r.income) * 100 : null,
      cumulative: r2(running),
    };
  });
  return { rows: out, startMonth, opening: r2(opening), unconverted, openingMissingRate };
}

/** Average "extra" over the finished months only (this month is still in progress). null if none. */
export function averageExtra(rows) {
  const done = rows.filter((r) => !r.partial && r.count > 0);
  if (done.length === 0) return null;
  return { months: done.length, avg: r2(done.reduce((s, r) => s + r.extra, 0) / done.length) };
}
