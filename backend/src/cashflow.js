/**
 * Cashflow ledger (money in / money out), kept in its OWN file (cashflow.json)
 * next to store.json -- deliberately NOT inside the main app data. The main
 * dashboard saves by PUT-ing its whole data object; if entries lived there, a save
 * from a stale browser tab could silently wipe entries added from a phone.
 * Here every entry is added/edited/deleted individually, server-side, so that
 * cannot happen.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "cashflow.json");

export const TYPES = ["in", "out", "transfer"];
export const CURRENCIES = ["SGD", "MYR"];
export const PEOPLE = ["KT", "J", "B"];
const DEFAULT_CATEGORIES = {
  in: ["Dividends", "Pawvy", "HDB rental", "Other income"],
  out: ["Rent", "Food & dining", "Groceries", "Transport & fuel", "Utilities & internet", "Dog", "Health", "Shopping", "Travel", "Other"],
};

// Settings for the Monthly summary: cash on hand when the running total starts, which month it
// starts from, and which spending categories are really investing (counted as saved, not spent).
const DEFAULT_SETTINGS = { openingBalance: 0, openingCurrency: "SGD", openingMonth: null, investCategories: [] };

function normalizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS, investCategories: [] };
  if (!s || typeof s !== "object") return out;
  const bal = typeof s.openingBalance === "number" ? s.openingBalance : parseFloat(s.openingBalance);
  if (isFinite(bal) && Math.abs(bal) <= 1e9) out.openingBalance = Math.round(bal * 100) / 100;
  if (CURRENCIES.includes(s.openingCurrency)) out.openingCurrency = s.openingCurrency;
  if (typeof s.openingMonth === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s.openingMonth)) out.openingMonth = s.openingMonth;
  if (Array.isArray(s.investCategories)) {
    const seen = new Set();
    for (const raw of s.investCategories) {
      const c = typeof raw === "string" ? raw.trim() : "";
      if (!c || c.length > 40 || seen.has(c.toLowerCase()) || out.investCategories.length >= 50) continue;
      seen.add(c.toLowerCase());
      out.investCategories.push(c);
    }
  }
  return out;
}

function fresh() {
  return { version: 1, categories: { in: [...DEFAULT_CATEGORIES.in], out: [...DEFAULT_CATEGORIES.out] }, entries: [], settings: normalizeSettings(null) };
}

function readStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) return fresh();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch (e) {
    // Never silently start over on a corrupt file -- that would later overwrite real records.
    throw new Error(`cashflow.json is unreadable (${e.message}); refusing to continue so no records are overwritten`);
  }
  const base = fresh();
  return {
    version: 1,
    categories: {
      in: Array.isArray(parsed?.categories?.in) ? parsed.categories.in : base.categories.in,
      out: Array.isArray(parsed?.categories?.out) ? parsed.categories.out : base.categories.out,
    },
    entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
    settings: normalizeSettings(parsed?.settings),
  };
}

// Write to a temp file then rename: a crash mid-write can never leave a half-written ledger.
function writeStore(store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, FILE);
}

/** Today's date in Singapore/Malaysia time (UTC+8), as YYYY-MM-DD. */
export function todaySGT() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function isRealDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

/** Validates & normalises an entry body. Returns { entry } or { error }. */
export function validateEntry(body, store) {
  const b = body || {};
  const type = b.type;
  if (!TYPES.includes(type)) return { error: "type must be in, out or transfer" };
  const amount = typeof b.amount === "number" ? b.amount : parseFloat(b.amount);
  if (!isFinite(amount) || amount <= 0 || amount > 1e9) return { error: "amount must be a positive number" };
  if (!CURRENCIES.includes(b.currency)) return { error: "currency must be SGD or MYR" };
  const date = b.date || todaySGT();
  if (!isRealDate(date)) return { error: "date must be a real date (YYYY-MM-DD)" };
  const who = b.who;
  if (!PEOPLE.includes(who)) return { error: `who must be one of ${PEOPLE.join(", ")}` };
  let category = typeof b.category === "string" ? b.category.trim() : "";
  if (type === "transfer") category = category || "Exchange";
  if (!category) return { error: "category is required" };
  if (category.length > 40) return { error: "category too long" };
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) : "";
  return { entry: { type, amount: Math.round(amount * 100) / 100, currency: b.currency, date, who, category, note } };
}

export function getAll() {
  const s = readStore();
  return { categories: s.categories, people: PEOPLE, entries: s.entries, settings: s.settings };
}

/** Saves the Monthly summary settings. Rejects clearly bad input instead of quietly storing a default. */
export function setSettings(body) {
  const b = body || {};
  if (b.openingBalance !== undefined) {
    const n = typeof b.openingBalance === "number" ? b.openingBalance : parseFloat(b.openingBalance);
    if (!isFinite(n) || Math.abs(n) > 1e9) return { error: "openingBalance must be a number" };
  }
  if (b.openingCurrency !== undefined && !CURRENCIES.includes(b.openingCurrency)) return { error: "openingCurrency must be SGD or MYR" };
  if (b.openingMonth !== undefined && b.openingMonth !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.openingMonth)) return { error: "openingMonth must look like 2026-11" };
  if (b.investCategories !== undefined && !Array.isArray(b.investCategories)) return { error: "investCategories must be a list" };
  const store = readStore();
  store.settings = normalizeSettings({ ...store.settings, ...b });
  writeStore(store);
  return { settings: store.settings };
}

/**
 * Adds an entry. `clientId` makes retries safe: if the phone sends the same entry twice
 * (double tap, bad signal then retry), the second call returns the first entry instead of
 * creating a duplicate.
 */
export function addEntry(body) {
  const store = readStore();
  const clientId = typeof body?.clientId === "string" && body.clientId.length <= 80 ? body.clientId : null;
  if (clientId) {
    const existing = store.entries.find((e) => e.clientId === clientId);
    if (existing) return { entry: existing, duplicate: true };
  }
  const v = validateEntry(body, store);
  if (v.error) return { error: v.error };
  const entry = { id: crypto.randomUUID(), clientId, ...v.entry, createdAt: new Date().toISOString(), updatedAt: null };
  store.entries.push(entry);
  writeStore(store);
  return { entry };
}

export function updateEntry(id, body) {
  const store = readStore();
  const idx = store.entries.findIndex((e) => e.id === id);
  if (idx < 0) return { error: "not found", status: 404 };
  const v = validateEntry(body, store);
  if (v.error) return { error: v.error };
  const old = store.entries[idx];
  store.entries[idx] = { ...old, ...v.entry, updatedAt: new Date().toISOString() };
  writeStore(store);
  return { entry: store.entries[idx] };
}

export function deleteEntry(id) {
  const store = readStore();
  const idx = store.entries.findIndex((e) => e.id === id);
  if (idx < 0) return { error: "not found", status: 404 };
  const [removed] = store.entries.splice(idx, 1);
  writeStore(store);
  return { removed };
}

/** Replaces the category lists. Existing entries keep whatever category name they were saved with. */
export function setCategories(body) {
  const clean = (arr) => {
    if (!Array.isArray(arr)) return null;
    const seen = new Set();
    const out = [];
    for (const raw of arr) {
      const c = typeof raw === "string" ? raw.trim() : "";
      if (!c || c.length > 40 || seen.has(c.toLowerCase())) continue;
      seen.add(c.toLowerCase());
      out.push(c);
    }
    return out;
  };
  const inCats = clean(body?.in);
  const outCats = clean(body?.out);
  if (!inCats || !outCats) return { error: "in and out must be lists" };
  if (inCats.length < 1 || outCats.length < 1) return { error: "keep at least one category for In and for Out" };
  const store = readStore();
  store.categories = { in: inCats, out: outCats };
  writeStore(store);
  return { categories: store.categories };
}
