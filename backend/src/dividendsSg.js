import * as cheerio from "cheerio";

/**
 * Scrapes https://www.dividends.sg/view/{TICKER} -- a plain server-rendered
 * table (Year / Yield / Total / Amount / Ex Date / Pay Date). No JS rendering
 * needed. If the site's markup changes, this is the one place to fix it --
 * the row-parsing loop below is the fragile part.
 *
 * Returns { rows: [{amount, exDate, payDate}] } or null on failure.
 *
 * HISTORY / WHY THIS FILE LOOKS THE WAY IT DOES:
 * We used to also scrape the page's own summary stats ("TTM Dividend Yield",
 * "Annual dividend per unit") and treat them as more trustworthy than summing
 * the raw rows ourselves. That turned out to be WRONG -- verified directly
 * against real cash CLR paid out (Sep 2026): the site's own "Annual dividend
 * per unit" figure (0.0316) undercounted a real distribution, while summing
 * the raw rows -- after removing an exact-duplicate row the site lists twice
 * -- landed exactly on the real amount received (0.023/share, confirmed to
 * the cent against 3 actual bank credits). So: don't trust the site's own
 * summary stats, and don't blindly sum every raw row either (duplicates).
 * Dedup exact-duplicate rows within a distribution, then sum what's left.
 * That's the only rule this file follows now -- simpler, and verified.
 */
export async function fetchDividendsSg(ticker) {
  try {
    const res = await fetch(`https://www.dividends.sg/view/${ticker}`, {
      headers: { "User-Agent": "Mozilla/5.0 (KT-Investment-Monitor)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    const rows = [];
    $("table tr").each((_, el) => {
      const cells = $(el).find("td");
      const n = cells.length;
      if (n < 4) return; // need at least Amount, Ex Date, Pay Date, Particulars
      // Index from the RIGHT: the site uses rowspan for Year/Yield/Total on the first
      // row of each group, so continuation rows have fewer leading columns -- but the
      // last 4 columns (Amount, Ex Date, Pay Date, Particulars) are always present.
      const amountText = $(cells[n - 4]).text().trim().replace("SGD", "").trim();
      const exDate = $(cells[n - 3]).text().trim();
      const payDate = $(cells[n - 2]).text().trim();
      const amount = parseFloat(amountText);
      if (!isNaN(amount) && /^\d{4}-\d{2}-\d{2}$/.test(exDate) && /^\d{4}-\d{2}-\d{2}$/.test(payDate)) {
        rows.push({ amount, exDate, payDate });
      }
    });

    return { rows };
  } catch (e) {
    console.error(`fetchDividendsSg(${ticker}) failed:`, e.message);
    return null;
  }
}

/**
 * Groups raw per-tranche rows into one entry per actual pay date.
 *
 * IMPORTANT: dividends.sg sometimes lists an EXACT duplicate row (same
 * amount, same ex-date, same pay-date) alongside genuinely distinct tranches
 * -- confirmed on CLR's 30 Jul 2026 distribution, which listed 0.0067 twice
 * plus two other distinct amounts (0.0038, 0.0125). The real per-unit payout
 * (verified against actual cash received) was 0.0067 + 0.0038 + 0.0125 --
 * i.e. each DISTINCT amount counted once, not "sum everything" and not
 * "drop every amount that repeats" (the site's own summary does the latter,
 * which is why we don't use it -- see fetchDividendsSg above).
 *
 * So: within a (exDate, payDate) group, keep each distinct amount value
 * only once, then sum the distinct amounts.
 */
export function groupByPayDate(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.exDate}|${r.payDate}`;
    if (!byKey.has(key)) byKey.set(key, { exDate: r.exDate, payDate: r.payDate, amounts: new Set() });
    byKey.get(key).amounts.add(r.amount);
  }
  return [...byKey.values()]
    .map((g) => ({ exDate: g.exDate, payDate: g.payDate, amount: [...g.amounts].reduce((s, a) => s + a, 0) }))
    .sort((a, b) => b.payDate.localeCompare(a.payDate));
}
