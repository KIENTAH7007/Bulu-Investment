import * as cheerio from "cheerio";

/**
 * Scrapes https://www.dividends.sg/view/{TICKER} -- a plain server-rendered
 * table (Year / Yield / Total / Amount / Ex Date / Pay Date). No JS rendering
 * needed. If the site's markup changes, this is the one place to fix it --
 * the row-parsing loop below is the fragile part.
 *
 * Returns { rows: [{amount, exDate, payDate}], ttmYield } or null on failure.
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

    // TTM yield shown near the top of the page, e.g. "TTM Dividend Yield: 5.35%"
    const bodyText = $.text();
    const ttmMatch = bodyText.match(/TTM Dividend Yield:\s*([\d.]+)%/);
    const ttmYield = ttmMatch ? parseFloat(ttmMatch[1]) : null;

    return { rows, ttmYield };
  } catch (e) {
    console.error(`fetchDividendsSg(${ticker}) failed:`, e.message);
    return null;
  }
}

/**
 * Groups raw per-tranche rows (dividends.sg lists each distribution
 * component separately) into one entry per actual pay date, and returns
 * the most recent N distinct pay-date entries with their combined amount.
 */
export function groupByPayDate(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.exDate}|${r.payDate}`;
    if (!byKey.has(key)) byKey.set(key, { exDate: r.exDate, payDate: r.payDate, amount: 0 });
    byKey.get(key).amount += r.amount;
  }
  return [...byKey.values()].sort((a, b) => b.payDate.localeCompare(a.payDate));
}
