import express from "express";
import { loadData, saveData } from "./store.js";
import { runCheckin } from "./checkin.js";

const router = express.Router();

router.get("/data", (req, res) => {
  res.json(loadData());
});

router.put("/data", (req, res) => {
  const saved = saveData(req.body);
  res.json(saved);
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
    !ticker || h.id === ticker ? { ...h, alertState: { tier1: false, tier2: false } } : h
  );
  saveData(data);
  res.json({ reset: ticker || "all" });
});

export default router;
