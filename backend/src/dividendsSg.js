import * as cheerio from "cheerio";

/**
 * Scrapes https://www.dividends.sg/view/{TICKER} -- a plain server-rendered
 * table (Year / Yield / Total / Amount / Ex Date / Pay Date). No JS rendering
 * needed. If the site's markup changes, this is the one place to fix it --
 * the row-parsing loop below is the fragile part.
 *
 * Returns { rows, ttmYield, annualDivPerUnit } or null on failure.
 *
 * IMPORTANT: `rows` is the raw per-tranche table -- dividends.sg sometimes
 * lists more than one row for the exact same ex-date/pay-date (multiple
 * source reports, occasionally an outright duplicate amount). Summing every
 * row blindly (which this file used to do via groupByPayDate) can overstate
 * the real distribution -- confirmed against CLR's 30 Jul 2026 distribution,
 * where the site lists 4 rows for one payout including a duplicated 0.0067
 * amount, inflating a naive sum by ~60% versus the site's own published
 * total. So `rows` should now only be trusted for DATES (calendar entries,
 * ex-date cooldown tracking) -- never for summed amounts. For the actual
 * per-unit distribution total and yield, use `annualDivPerUnit`/`ttmYield`
 * below, which are dividends.sg's own already-deduplicated, published
 * figures -- scraped directly off the page rather than re-derived here.
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

    const bodyText = $.text();

    // TTM yield -- the site's wording has changed over time (was "TTM Dividend
    // Yield: X%", now seen as "Yield · past 12 months: X% TTM"). Try known
    // phrasings; log clearly if none match so this doesn't silently go stale again.
    let ttmYield = null;
    const ttmPatterns = [
      /TTM Dividend Yield:\s*([\d.]+)%/,
      /Yield[^\d%]{0,40}past 12 months[^\d%]{0,20}?([\d.]+)%/i,
      /past 12 months[^\d%]{0,40}?([\d.]+)%\s*TTM/i,
    ];
    for (const re of ttmPatterns) {
      const m = bodyText.match(re);
      if (m) { ttmYield = parseFloat(m[1]); break; }
    }

    // Annual dividend per unit -- dividends.sg's OWN computed, deduplicated total
    // (shown per calendar-year section, most recent year first). We deliberately
    // use this instead of summing `rows` ourselves -- see note above.
    let annualDivPerUnit = null;
    const divMatch = bodyText.match(/Annual dividend per unit[^\d]{0,20}?([\d.]+)/i);
    if (divMatch) annualDivPerUnit = parseFloat(divMatch[1]);

    if (ttmYield === null) {
      console.warn(`[dividendsSg] TTM yield text not found on page -- site markup may have changed again`);
    }
    if (annualDivPerUnit === null) {
      console.warn(`[dividendsSg] "Annual dividend per unit" text not found on page -- site markup may have changed`);
    }

    return { rows, ttmYield, annualDivPerUnit };
  } catch (e) {
    console.error(`fetchDividendsSg(${ticker}) failed:`, e.message);
    return null;
  }
}

/**
 * Groups raw per-tranche rows (dividends.sg lists each distribution
 * component separately) into one entry per actual pay date, and returns
 * the most recent N distinct pay-date entries with their combined amount.
 *
 * NOTE: this sums every row sharing an (exDate, payDate) key, which can
 * double-count duplicate/multi-source rows (see the big comment above).
 * Only use the *dates* this produces for calendar/cooldown purposes --
 * don't treat the summed `amount` as authoritative. It's still used as a
 * rough per-share estimate for *future/estimated* calendar entries, where
 * exactness matters less than having a plausible number until a confirmed
 * figure arrives.
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
