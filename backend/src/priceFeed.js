// Free, unauthenticated Yahoo Finance chart endpoint. SGX tickers use a ".SI" suffix.
// This is an unofficial endpoint -- if Yahoo changes it, this is the one place to fix.
const BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

function toYahooSymbol(ticker) {
  return `${ticker}.SI`;
}

/**
 * Fetches the latest price for a ticker.
 * Returns { price, asOf } or null on failure (never throws -- a failed fetch
 * should not crash a check-in, it should just skip that ticker this round).
 */
export async function fetchLatestPrice(ticker) {
  try {
    const res = await fetch(`${BASE}${toYahooSymbol(ticker)}?interval=1d&range=5d`, {
      headers: { "User-Agent": "Mozilla/5.0 (KT-Investment-Monitor)" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const closes = result.indicators?.quote?.[0]?.close || [];
    const timestamps = result.timestamp || [];
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] != null) {
        return { price: Math.round(closes[i] * 1000) / 1000, asOf: new Date(timestamps[i] * 1000).toISOString().slice(0, 10) };
      }
    }
    return null;
  } catch (e) {
    console.error(`fetchLatestPrice(${ticker}) failed:`, e.message);
    return null;
  }
}

/**
 * One-time (or periodic) backfill of daily closes, so moving averages don't
 * need months to accumulate from scratch. range examples: "1y", "2y".
 * Returns [{date, close}, ...] oldest first, or [] on failure.
 */
export async function fetchHistory(ticker, range = "2y") {
  try {
    const res = await fetch(`${BASE}${toYahooSymbol(ticker)}?interval=1d&range=${range}`, {
      headers: { "User-Agent": "Mozilla/5.0 (KT-Investment-Monitor)" },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const timestamps = result.timestamp || [];
    const out = [];
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] != null) {
        out.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close: Math.round(closes[i] * 1000) / 1000 });
      }
    }
    return out;
  } catch (e) {
    console.error(`fetchHistory(${ticker}) failed:`, e.message);
    return [];
  }
}
