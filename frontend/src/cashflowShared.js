// Shared helpers for the Cashflow tab (main app) and the /add entry page.

export const COLORS = {
  bg: "#14213D", sidebar: "#0F1930", surface: "#1C2B4D", surfaceRaised: "#22335C",
  border: "#32406E", orange: "#F36F4A", cream: "#F5F2EB",
  green: "#6FCF97", greenSoft: "#20362A", amber: "#E8B84B", amberSoft: "#3D3420",
  red: "#E2574C", redSoft: "#3D2220", blue: "#6B9FE8", blueSoft: "#1F3158",
  textPrimary: "#F5F2EB", textSecondary: "#A9B2C8", textMuted: "#6B7591",
};
export const H = { fontFamily: "'Bebas Neue', sans-serif", letterSpacing: 0.5 };

export const PEOPLE = ["KT", "J", "B"];
export const CURRENCIES = ["SGD", "MYR"];
export const TYPE_LABEL = { in: "In", out: "Out", transfer: "Transfer" };
export const TYPE_COLOR = { in: COLORS.green, out: COLORS.orange, transfer: COLORS.blue };

export function fmt(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toLocaleString("en-SG", { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function money(n, cur, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  const sign = n < 0 ? "-" : "";
  return `${sign}${cur === "MYR" ? "RM" : "S$"}${fmt(Math.abs(n), d)}`;
}

/** Today's date on THIS device, as YYYY-MM-DD (not UTC, so late-night entries get the right day). */
export function localDateISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function newClientId() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  return "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(key, withYear = true) {
  const [y, m] = key.split("-");
  return withYear ? `${MONTHS[Number(m) - 1]} ${y}` : MONTHS[Number(m) - 1];
}
export function shiftMonth(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function monthsBetween(fromKey, toKey) {
  const out = [];
  let k = fromKey;
  for (let i = 0; i < 600 && k <= toKey; i++) { out.push(k); k = shiftMonth(k, 1); }
  return out;
}

/** MYR per 1 SGD on a date: the latest known rate on or before it (earliest if before all history). */
export function rateOn(history, date) {
  if (!Array.isArray(history) || history.length === 0) return null;
  let lo = 0, hi = history.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (history[mid].date <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const p = history[ans === -1 ? 0 : ans];
  return p && p.rate > 0 ? p.rate : null;
}

/** Amount of an entry expressed in `to` currency, using that day's market rate. null if no rate available. */
export function convert(entry, to, history) {
  if (entry.currency === to) return entry.amount;
  const r = rateOn(history, entry.date);
  if (!r) return null;
  return to === "SGD" ? entry.amount / r : entry.amount * r;
}

function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection from free-text notes
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function buildCsv(entries, history) {
  const rows = [["date", "entered_at", "who", "type", "category", "note", "amount", "currency", "approx_SGD", "approx_MYR"]];
  for (const e of entries) {
    const sgd = convert(e, "SGD", history), myr = convert(e, "MYR", history);
    rows.push([e.date, e.createdAt, e.who, e.type, e.category, e.note, e.amount, e.currency,
      sgd === null ? "" : sgd.toFixed(2), myr === null ? "" : myr.toFixed(2)]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
