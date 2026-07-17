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
      if (cells.length < 6) return;
      const amountText = $(cells[3]).text().trim().replace("SGD", "").trim();
      const exDate = $(cells[4]).text().trim();
      const payDate = $(cells[5]).text().trim();
      const amount = parseFloat(amountText);
      if (!isNaN(amount) && /^\d{4}-\d{2}-\d{2}$/.test(exDate)) {
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
