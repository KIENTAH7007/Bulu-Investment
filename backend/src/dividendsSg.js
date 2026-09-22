import * as cheerio from "cheerio";

/**
 * Scrapes https://www.dividends.sg/view/{TICKER}.
 *
 * As of 2026-09-19 dividends.sg redesigned this page's dividend-history
 * markup: it used to be a plain <table><tr><td> per row; it is now a set of
 * <article class="dividend-history-event"> blocks (grouped under
 * <details class="dividend-history-year"> per year), each holding:
 *   <p class="dividend-history-event__amount">SGD 0.0067</p>
 *   <dl class="dividend-event-dates">
 *     <div><dt>Ex-date</dt><dd><time datetime="2026-07-30">...</time></dd></div>
 *     <div><dt>Pays</dt><dd><time datetime="2026-08-28">...</time></dd></div>
 *   </dl>
 * Confirmed against the live page's raw HTML (not just the rendered view --
 * fetched the exact bytes and located a known amount inside them). We match
 * Ex-date/Pay-date by the <dt> label text rather than fixed column position,
 * so a future reordering of the two rows doesn't silently break this again
 * the way the old fixed <table><tr><td> selector did on this redesign.
 *
 * Returns { rows: [{amount, exDate, payDate}] } or null on a hard fetch
 * failure. A successful-but-empty result (rows: []) is possible if the site
 * changes markup again -- callers should treat that as a signal too, not
 * just null (see checkin.js's refreshDividends, which now warns on both).
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
 * summary stats (still true post-redesign -- the same figures now live in
 * <summary class="dividend-year-header"><span class="dividend-year-header__metrics">,
 * and we still ignore that block entirely), and don't blindly sum every raw
 * row either (duplicates). Dedup exact-duplicate rows within a distribution,
 * then sum what's left -- see groupByPayDate.
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
    $("article.dividend-history-event").each((_, el) => {
      const amountText = $(el)
        .find(".dividend-history-event__amount")
        .first()
        .text()
        .trim()
        .replace("SGD", "")
        .trim();
      const amount = parseFloat(amountText);

      let exDate = null;
      let payDate = null;
      $(el)
        .find("dl.dividend-event-dates > div")
        .each((_, div) => {
          const label = $(div).find("dt").text().trim().toLowerCase();
          const datetime = $(div).find("time").attr("datetime");
          if (!datetime || !/^\d{4}-\d{2}-\d{2}$/.test(datetime)) return;
          if (label.startsWith("ex")) exDate = datetime;
          else if (label.startsWith("pay")) payDate = datetime;
        });

      if (!isNaN(amount) && exDate && payDate) {
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
