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

export default router;
