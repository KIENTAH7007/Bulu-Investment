import express from "express";
import { loadData, saveData } from "./store.js";
import { runCheckin } from "./checkin.js";
import * as cashflow from "./cashflow.js";

const router = express.Router();

router.get("/data", (req, res) => {
  res.json(loadData());
});

router.put("/data", (req, res) => {
  const saved = saveData(req.body);
  res.json(saved);
});

// DCA Planner settings (budget, lot sizes, custom split). Saved on their own so tweaking them never
// rewrites the whole portfolio -- and a check-in running at the same moment can't be overwritten by it.
router.put("/planner-settings", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ error: "Expected a settings object" });
  const data = loadData();
  data.plannerSettings = body;
  saveData(data);
  res.json(data.plannerSettings);
});

// Manual trigger, e.g. for testing after deploy: POST /api/checkin
router.post("/checkin", async (req, res) => {
  try {
    const result = await runCheckin("manual");
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Resets alertState so the next check-in treats currently-met conditions as fresh
// (use this if an alert never actually delivered, e.g. before Telegram was set up).
// POST /api/reset-alerts with no body resets all holdings; { ticker: "CLR" } resets just one.
router.post("/reset-alerts", (req, res) => {
  const data = loadData();
  const ticker = req.body?.ticker;
  data.holdings = data.holdings.map((h) =>
    !ticker || h.id === ticker ? { ...h, alertState: { tier1: false, tier2: false, tier1LastFired: null, tier2LastFired: null } } : h
  );
  saveData(data);
  res.json({ reset: ticker || "all" });
});

// ---- Cashflow ledger (separate file, entry-by-entry -- see cashflow.js) ----
const cfSend = (res, fn) => {
  try {
    const out = fn();
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    return res.json(out);
  } catch (e) {
    console.error("cashflow error:", e);
    return res.status(500).json({ error: e.message });
  }
};
router.get("/cashflow", (req, res) => cfSend(res, () => cashflow.getAll()));
router.post("/cashflow/entries", (req, res) => cfSend(res, () => cashflow.addEntry(req.body)));
router.put("/cashflow/entries/:id", (req, res) => cfSend(res, () => cashflow.updateEntry(req.params.id, req.body)));
router.delete("/cashflow/entries/:id", (req, res) => cfSend(res, () => cashflow.deleteEntry(req.params.id)));
router.put("/cashflow/categories", (req, res) => cfSend(res, () => cashflow.setCategories(req.body)));

export default router;
