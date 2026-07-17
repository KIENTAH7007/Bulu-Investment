import fs from "fs";
import path from "path";

// DATA_DIR should point at a Railway Volume mount (e.g. /data) so it survives
// redeploys. Falls back to a local ./data folder for local dev.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

function seedData() {
  return {
    goal: 2000,
    monthlyDCA: 500,
    extraCash: 0,
    holdings: [
      {
        id: "CLR", name: "Lion-Phillip S-REIT ETF", shares: 244991, avgCost: 0.923,
        price: 0.841, annualDiv: 0.045, divReceived: 0,
        // REIT ETF: no P/B tracking, uses yield-average + MA criteria instead
        priceHistory: [], yieldHistory: [],
        criteria: { type: "reit", yieldLookbackQuarters: 8, maPeriod: 50 },
        alertState: { tier1: false, tier2: false },
      },
      {
        id: "G3B", name: "Amova Singapore STI ETF", shares: 0, avgCost: 0,
        price: 5.59, annualDiv: 0.19, divReceived: 0,
        priceHistory: [], yieldHistory: [],
        criteria: { type: "index-dca", maPeriod: 200, bonusDipPct: 8 },
        alertState: { tier1: false, tier2: false },
      },
      {
        id: "U11", name: "UOB", shares: 100, avgCost: 39.10,
        price: 44.29, annualDiv: 1.56, divReceived: 0,
        bookValuePerShare: 34.6, // manually refreshed quarterly -- see README
        payoutRatio: 57,
        priceHistory: [], yieldHistory: [],
        criteria: { type: "bank-pb", pbLookbackYears: 5, pbHistoricalAvg: 1.15, pbHistoricalBandLow: 1.0 }, // placeholder -- verify against real 5yr data before going live
        alertState: { tier1: false, tier2: false },
      },
      {
        id: "D05", name: "DBS Group Holdings", shares: 100, avgCost: 65.78,
        price: 70.28, annualDiv: 2.79, divReceived: 0,
        bookValuePerShare: 19.09, // manually refreshed quarterly -- see README
        payoutRatio: 64,
        priceHistory: [], yieldHistory: [],
        criteria: { type: "bank-pb", pbLookbackYears: 5, pbHistoricalAvg: 1.9, pbHistoricalBandLow: 1.6 }, // placeholder -- verify against real 5yr data before going live
        alertState: { tier1: false, tier2: false },
      },
    ],
    otherHoldings: [
      { id: "NVDA", name: "NVIDIA (MooMoo reward)", shares: 0.0818, price: 0 },
      { id: "SPCX", name: "SpaceX exposure (MooMoo reward)", shares: 0.1456, price: 0 },
    ],
    watchlist: [
      { id: "O39", name: "OCBC Bank", price: 0, notes: "", priceHistory: [] },
    ],
    dividendCalendar: [
      { id: "CLR", exDate: "2026-07-30", payDate: "2026-08-28", perShare: 0.02, estimated: true, source: "dividends.sg pattern" },
      { id: "U11", exDate: "2026-10-23", payDate: "2026-11-06", perShare: 0.71, estimated: true, source: "pattern estimate" },
      { id: "D05", exDate: "2026-08-10", payDate: "2026-08-19", perShare: 0.81, estimated: true, source: "pattern estimate" },
      { id: "G3B", exDate: "2027-01-04", payDate: "2027-01-15", perShare: 0.0967, estimated: true, source: "pattern estimate" },
    ],
    alertLog: [],
    incomeHistory: [],
    divHistory: [],
    lastCheckin: null,
  };
}

export function loadData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const seed = seedData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

export function saveData(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  return data;
}
