import "dotenv/config";
import express from "express";
import path from "path";
import cron from "node-cron";
import apiRoutes from "./src/routes.js";
import { runCheckin } from "./src/checkin.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use("/api", apiRoutes);

// Serve the built frontend (see README -- `npm run build` in /frontend first)
const FRONTEND_DIST = path.join(process.cwd(), "..", "frontend", "dist");
app.use(express.static(FRONTEND_DIST));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "not found" });
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

app.listen(PORT, () => console.log(`KT Investment backend listening on port ${PORT}`));

// Twice daily: 08:30 SGT (00:30 UTC) before market open, 13:00 SGT (05:00 UTC).
// Cron schedules run in UTC by default -- adjust here if your Railway region differs.
cron.schedule("30 0 * * *", () => runCheckin("scheduled-morning"));
cron.schedule("0 5 * * *", () => runCheckin("scheduled-afternoon"));

console.log("Scheduled check-ins: 08:30 SGT and 13:00 SGT daily");
