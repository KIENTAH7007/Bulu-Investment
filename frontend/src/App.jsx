import React, { useState, useEffect, useMemo, useCallback } from "react";
import Cashflow from "./Cashflow.jsx";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, ComposedChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine
} from "recharts";

const COLORS = {
  bg: "#14213D", sidebar: "#0F1930", surface: "#1C2B4D", surfaceRaised: "#22335C",
  border: "#32406E", orange: "#F36F4A", orangeSoft: "#4A2E22", cream: "#F5F2EB",
  green: "#6FCF97", greenSoft: "#20362A", amber: "#E8B84B", amberSoft: "#3D3420",
  red: "#E2574C", redSoft: "#3D2220", textPrimary: "#F5F2EB", textSecondary: "#A9B2C8", textMuted: "#6B7591",
};
const PIE_COLORS = ["#F36F4A", "#6FCF97", "#6B9FE8", "#E8B84B", "#B08CE8", "#6B7591"];
const H = { fontFamily: "'Bebas Neue', sans-serif", letterSpacing: 0.5 };
const TICKER_LOOKUP = {
  D05: "DBS Group Holdings", O39: "OCBC Bank", U11: "UOB", Z74: "Singtel",
  C6L: "Singapore Airlines", C38U: "CapitaLand Integrated Commercial Trust",
  A17U: "Ascendas REIT", S68: "SGX", BN4: "Keppel Ltd", C09: "City Developments",
  G3B: "Amova Singapore STI ETF", CLR: "Lion-Phillip S-REIT ETF", ES3: "SPDR STI ETF",
  YLD: "Lion-OCBC Securities APAC Financials Dividend Plus ETF",
};
// Defaults for the SGD/MYR alert settings -- must match FX_DEFAULT_SETTINGS in backend/src/fx.js.
const FX_DEFAULTS = { thresholdPct: 1.0, monthlySpendMYR: 7000, monthsToConvert: 3 };
function safetyFlag(payoutRatio) {
  if (payoutRatio === null || payoutRatio === undefined || payoutRatio === "") return { level: "none", text: "No data" };
  const pr = Number(payoutRatio);
  if (pr >= 95) return { level: "red", text: "Payout tight" };
  if (pr >= 75) return { level: "amber", text: "Watch payout" };
  return { level: "green", text: "Covered" };
}

function fmt(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toLocaleString("en-SG", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

function rollingMASeries(priceHistory, period) {
  if (!priceHistory || priceHistory.length < 5) return [];
  const step = priceHistory.length > 240 ? Math.floor(priceHistory.length / 240) : 1; // thin very long histories for chart performance
  const out = [];
  for (let i = 0; i < priceHistory.length; i += step) {
    const windowStart = Math.max(0, i - period + 1);
    const window = priceHistory.slice(windowStart, i + 1);
    const ma = window.length >= Math.min(period, 20) ? window.reduce((s, p) => s + p.close, 0) / window.length : null;
    out.push({ date: priceHistory[i].date, price: priceHistory[i].close, ma: ma !== null ? Math.round(ma * 1000) / 1000 : null });
  }
  return out;
}

function describeGates(r) {
  const c = r.criteria || {};
  if (c.type === "index-dca") {
    return { tier1: "Scheduled DCA date reached", tier2: `Price ${c.bonusDipPct}%+ below its ${c.maPeriod}-day average`, purchase: "DCA (T1) / Bonus lump sum (T2)" };
  }
  if (c.type === "reit") {
    return { tier1: `Yield above its own ${c.yieldLookbackQuarters}-quarter average, no structural breakdown`, tier2: `All of Tier 1, plus price also below its ${c.maPeriod}-day average`, purchase: "Lump sum (both tiers)" };
  }
  if (c.type === "bank-pb") {
    return { tier1: `P/B below its own ${c.pbLookbackYears}-year average (${c.pbHistoricalAvg ?? "?"}x), trend still healthy`, tier2: `P/B has dropped into the cheap band (<= ${c.pbHistoricalBandLow ?? "?"}x)`, purchase: "Lump sum (both tiers)" };
  }
  return { tier1: "Not configured", tier2: "Not configured", purchase: "-" };
}

function pbSeries(priceHistory, bookValuePerShare) {
  if (!priceHistory || !bookValuePerShare) return [];
  const step = priceHistory.length > 240 ? Math.floor(priceHistory.length / 240) : 1;
  const out = [];
  for (let i = 0; i < priceHistory.length; i += step) {
    out.push({ date: priceHistory[i].date, pb: Math.round((priceHistory[i].close / bookValuePerShare) * 1000) / 1000 });
  }
  return out;
}

function Card({ label, value, sub, accent }) {
  return (
    <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px", flex: "1 1 160px", minWidth: 150 }}>
      <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 500, color: accent || COLORS.textPrimary }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h2 style={{ ...H, fontWeight: 400, fontSize: 22, color: COLORS.textPrimary, margin: 0, textTransform: "uppercase" }}>{children}</h2>
      {sub && <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function EditableCell({ value, onChange, width = 70 }) {
  return <input type="number" step="any" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
    style={{ width, background: "transparent", border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontFamily: "monospace", fontSize: 14, padding: "5px 7px", textAlign: "right" }} />;
}
function TextCell({ value, onChange, width = 110 }) {
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
    style={{ width, background: "transparent", border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontSize: 14, padding: "5px 7px" }} />;
}
function Field({ label, value, onChange, width = 100, prefix }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: COLORS.textSecondary }}>
      {label}
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {prefix && <span style={{ color: COLORS.textMuted }}>{prefix}</span>}
        <input type="number" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          style={{ width, background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontFamily: "monospace", fontSize: 14, padding: "6px 8px", textAlign: "right" }} />
      </span>
    </label>
  );
}
function Button({ children, onClick, variant = "default", disabled }) {
  const styles = {
    default: { background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, color: COLORS.textPrimary },
    orange: { background: COLORS.orange, border: `0.5px solid ${COLORS.orange}`, color: COLORS.sidebar, fontWeight: 600 },
    ghost: { background: "none", border: "none", color: COLORS.textMuted },
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...styles[variant], borderRadius: 8, padding: "8px 16px", fontSize: 14, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>{children}</button>;
}
function FlagBadge({ level, text }) {
  const map = { green: { bg: COLORS.greenSoft, color: COLORS.green }, amber: { bg: COLORS.amberSoft, color: COLORS.amber }, red: { bg: COLORS.redSoft, color: COLORS.red }, none: { bg: COLORS.surfaceRaised, color: COLORS.textMuted } };
  const s = map[level] || map.none;
  return <span style={{ background: s.bg, color: s.color, fontSize: 13, padding: "3px 9px", borderRadius: 12, fontWeight: 600 }}>{text}</span>;
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [strategyDraft, setStrategyDraft] = useState("");
  const [strategySaved, setStrategySaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [newAlert, setNewAlert] = useState("");
  const [buyTicker, setBuyTicker] = useState("");
  const [buyQty, setBuyQty] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [checkinRunning, setCheckinRunning] = useState(false);
  const [newStockPick, setNewStockPick] = useState("");
  const [actualAmounts, setActualAmounts] = useState({});
  const [expandedHoldings, setExpandedHoldings] = useState({});
  const toggleExpanded = (uid) => setExpandedHoldings((prev) => ({ ...prev, [uid]: !prev[uid] }));

  const DEFAULT_STRATEGY = `1) DCA G3B at $2,500 per month.
2) Dividends from all holdings default to G3B, EXCEPT when a Tier 1 / Tier 2 gate fires on CLR, U11, or D05 -- then that period's dividend cash goes there instead.
3) $45K from Chocolate Finance is reserved as dry powder, only deployed when a Tier 1/2 gate fires on CLR, U11, or D05.`;

  useEffect(() => {
    fetch("/api/data").then((r) => r.json()).then((d) => {
      const withUid = (arr, prefix) => (arr || []).map((item, i) => item.uid ? item : { ...item, uid: `${prefix}-${item.id || i}-${i}` });
      const normalized = {
        ...d,
        holdings: withUid(d.holdings, "h"),
        otherHoldings: withUid(d.otherHoldings, "o"),
        watchlist: withUid(d.watchlist, "w"),
        dividendCalendar: withUid(d.dividendCalendar, "d"),
        divHistory: d.divHistory || [],
      };
      setData(normalized);
      setStrategyDraft(normalized.strategyNotes || DEFAULT_STRATEGY);
      setLoading(false);
    }).catch((e) => { console.error(e); setLoading(false); });
  }, []);

  const saveStrategy = () => {
    save({ ...data, strategyNotes: strategyDraft, strategyUpdatedAt: todayISO() });
    setStrategySaved(true);
  };

  const save = useCallback(async (next) => {
    setData(next);
    setSaving(true);
    try {
      await fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    } catch (e) { console.error("Save failed", e); }
    setSaving(false);
  }, []);

  const runCheckinNow = async () => {
    setCheckinRunning(true);
    try {
      await fetch("/api/checkin", { method: "POST" });
      const fresh = await fetch("/api/data").then((r) => r.json());
      setData(fresh);
    } catch (e) { console.error(e); }
    setCheckinRunning(false);
  };

  const resetAndRecheck = async (ticker) => {
    setCheckinRunning(true);
    try {
      await fetch("/api/reset-alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ticker ? { ticker } : {}) });
      await fetch("/api/checkin", { method: "POST" });
      const fresh = await fetch("/api/data").then((r) => r.json());
      setData(fresh);
    } catch (e) { console.error(e); }
    setCheckinRunning(false);
  };

  const updateHolding = (uid, field, value) => save({ ...data, holdings: data.holdings.map((h) => h.uid === uid ? { ...h, [field]: value } : h) });
  const removeHolding = (uid) => save({ ...data, holdings: data.holdings.filter((h) => h.uid !== uid) });
  const addHolding = () => {
    if (!newStockPick) return;
    const uid = `h-new-${Date.now()}`;
    const base = { uid, shares: 0, avgCost: 0, price: 0, annualDiv: 0, divReceived: 0, payoutRatio: null, priceHistory: [], yieldHistory: [], criteria: { type: null } };
    if (newStockPick === "__custom__") {
      save({ ...data, holdings: [...data.holdings, { ...base, id: "NEW", name: "New stock" }] });
    } else {
      save({ ...data, holdings: [...data.holdings, { ...base, id: newStockPick, name: TICKER_LOOKUP[newStockPick] || newStockPick }] });
    }
    setNewStockPick("");
  };
  const updateOther = (uid, field, value) => save({ ...data, otherHoldings: data.otherHoldings.map((h) => h.uid === uid ? { ...h, [field]: value } : h) });

  const addAlert = () => {
    if (!newAlert.trim()) return;
    save({ ...data, alertLog: [{ date: todayISO(), text: newAlert.trim() }, ...data.alertLog] });
    setNewAlert("");
  };
  const removeAlert = (idx) => { const next = [...data.alertLog]; next.splice(idx, 1); save({ ...data, alertLog: next }); };

  const recordPurchase = () => {
    const qty = parseFloat(buyQty), price = parseFloat(buyPrice);
    if (!buyTicker || !qty || !price) return;
    const h = data.holdings.find((x) => x.uid === buyTicker);
    if (!h) return;
    const newShares = h.shares + qty;
    const newAvgCost = newShares > 0 ? ((h.shares * h.avgCost) + (qty * price)) / newShares : 0;
    save({
      ...data,
      holdings: data.holdings.map((x) => x.uid === buyTicker ? { ...x, shares: newShares, avgCost: newAvgCost, price } : x),
      alertLog: [{ date: todayISO(), text: `Bought ${qty} ${h.id} at $${price} -- new avg cost $${fmt(newAvgCost, 3)}` }, ...data.alertLog],
    });
    setBuyQty(""); setBuyPrice("");
  };

  const markReceived = (entry) => {
    const h = data.holdings.find((x) => x.id === entry.id);
    if (!h) return;
    const estimated = h.shares * entry.perShare;
    const raw = actualAmounts[entry.uid];
    const actual = raw !== undefined && raw !== "" ? parseFloat(raw) : null;
    const cash = actual !== null && !isNaN(actual) ? actual : estimated;
    const variancePct = actual !== null && estimated > 0 ? Math.abs(actual - estimated) / estimated * 100 : null;
    const logEntries = [{ date: todayISO(), text: `Received $${fmt(cash)} dividend from ${entry.id}${actual !== null ? ` (actual amount you entered -- app had estimated $${fmt(estimated)})` : ""}` }];
    if (variancePct !== null && variancePct > 5) {
      logEntries.unshift({ date: todayISO(), text: `⚠️ ${entry.id}: actual dividend ($${fmt(actual)}) differs from the app's estimate ($${fmt(estimated)}) by ${fmt(variancePct, 1)}% -- if this keeps happening it's worth flagging so the underlying data/calc can be checked.` });
    }
    save({
      ...data,
      holdings: data.holdings.map((x) => x.id === h.id ? { ...x, divReceived: (x.divReceived || 0) + cash } : x),
      dividendCalendar: data.dividendCalendar.filter((d) => d.uid !== entry.uid),
      divHistory: [{ id: entry.id, date: todayISO(), cash }, ...(data.divHistory || [])],
      alertLog: [...logEntries, ...data.alertLog],
    });
    setActualAmounts((prev) => { const next = { ...prev }; delete next[entry.uid]; return next; });
  };
  const logIncomeSnapshot = () => {
    const month = todayISO().slice(0, 7);
    const existing = (data.incomeHistory || []).filter((h) => h.month !== month);
    save({ ...data, incomeHistory: [...existing, { month, value: Math.round(computed.totalMonthlyIncome * 100) / 100 }].sort((a, b) => a.month.localeCompare(b.month)) });
  };

  const computed = useMemo(() => {
    if (!data) return null;
    const rows = data.holdings.map((h) => {
      const marketValue = h.shares * h.price;
      const costBasis = h.shares * h.avgCost;
      const monthlyIncome = (h.shares * h.annualDiv) / 12;
      const yieldOnCost = h.avgCost > 0 ? (h.annualDiv / h.avgCost) * 100 : null;
      const currentYield = h.price > 0 ? (h.annualDiv / h.price) * 100 : null;
      const totalReturn = (h.price - h.avgCost) * h.shares + (h.divReceived || 0);
      const totalReturnPct = costBasis > 0 ? (totalReturn / costBasis) * 100 : null;
      return { ...h, marketValue, costBasis, monthlyIncome, yieldOnCost, currentYield, totalReturn, totalReturnPct };
    });
    const totalMarketValue = rows.reduce((s, r) => s + r.marketValue, 0);
    const totalMonthlyIncome = rows.reduce((s, r) => s + r.monthlyIncome, 0);
    const totalCostBasis = rows.reduce((s, r) => s + r.costBasis, 0);
    const blendedAnnualYield = totalMarketValue > 0 ? (totalMonthlyIncome * 12 / totalMarketValue) * 100 : 0;
    return { rows, totalMarketValue, totalMonthlyIncome, totalCostBasis, blendedAnnualYield };
  }, [data]);

  const diversification = useMemo(() => computed ? computed.rows.filter((r) => r.monthlyIncome > 0).map((r) => ({ name: r.id, value: Math.round(r.monthlyIncome * 100) / 100 })) : [], [computed]);
  const yieldOnCostChart = useMemo(() => computed ? computed.rows.filter((r) => r.yieldOnCost !== null).map((r) => ({ name: r.id, yoc: Math.round(r.yieldOnCost * 100) / 100 })) : [], [computed]);
  const upcomingCalendar = useMemo(() => {
    if (!data) return [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return [...(data.dividendCalendar || [])].filter((d) => new Date(d.payDate) >= today).sort((a, b) => new Date(a.payDate) - new Date(b.payDate));
  }, [data]);
  // Next upcoming ex/pay date per ticker -- shown on each Portfolio holding card.
  const nextDivByTicker = useMemo(() => {
    const map = {};
    for (const d of upcomingCalendar) {
      if (!map[d.id]) map[d.id] = d;
    }
    return map;
  }, [upcomingCalendar]);
  // Single nearest upcoming distribution across the whole portfolio -- shown on the Dashboard.
  const nextDivOverall = upcomingCalendar.length > 0 ? upcomingCalendar[0] : null;

  if (loading || !data || !computed) return <div style={{ color: COLORS.textSecondary, padding: 40, fontFamily: "sans-serif", background: COLORS.bg, minHeight: "100vh" }}>Loading dashboard…</div>;

  const progressPct = Math.min(100, (computed.totalMonthlyIncome / data.goal) * 100);
  const navItems = [["dashboard", "Dashboard"], ["portfolio", "Portfolio"], ["gates", "Buy Criteria"], ["cashflow", "Cashflow"], ["strategy", "Strategy"], ["journal", "Journal"]];

  // SGD/MYR alert: values come from data.fx, which the backend check-in maintains.
  const fxSettings = { ...FX_DEFAULTS, ...((data.fx && data.fx.settings) || {}) };
  const fxLatest = (data.fx && data.fx.latest) || null;
  const fxHasAvg = !!(fxLatest && fxLatest.avg);
  const fxAbove = fxHasAvg && fxLatest.deviationPct >= fxSettings.thresholdPct;
  const fxStale = !!(fxLatest && (Date.now() - Date.parse(fxLatest.date)) / 86400000 > 4);
  const updateFxSetting = (field, value) => save({ ...data, fx: { ...(data.fx || {}), settings: { ...fxSettings, [field]: value } } });
  const fxSuggestedMyr = fxSettings.monthsToConvert > 0 && fxSettings.monthlySpendMYR > 0 ? fxSettings.monthsToConvert * fxSettings.monthlySpendMYR : 0;
  const fxSuggestedSgd = fxLatest && fxLatest.rate > 0 && fxSuggestedMyr > 0 ? Math.round(fxSuggestedMyr / fxLatest.rate / 100) * 100 : null;

  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", color: COLORS.textPrimary, fontFamily: "sans-serif", display: "flex" }}>
      <div style={{ width: sidebarOpen ? 200 : 52, background: COLORS.sidebar, padding: sidebarOpen ? "20px 12px" : "20px 8px", flexShrink: 0, transition: "width 0.2s" }}>
        <div onClick={() => setSidebarOpen(!sidebarOpen)} style={{ cursor: "pointer", fontSize: 18, color: COLORS.textSecondary, marginBottom: 18, padding: "0 4px" }}>☰</div>
        {sidebarOpen && (
          <>
            <div style={{ ...H, fontSize: 16, color: COLORS.orange, marginBottom: 2, padding: "0 8px" }}>BULU FAMILY</div>
            <div style={{ ...H, fontSize: 22, marginBottom: 8, padding: "0 8px", color: COLORS.cream }}>INVESTMENT</div>
            <div style={{ fontSize: 10, color: COLORS.textMuted, padding: "0 8px", marginBottom: 18 }}>
              {data.lastCheckin ? `Last check-in: ${new Date(data.lastCheckin.at).toLocaleString("en-SG")}` : "No check-in yet"}
            </div>
            {navItems.map(([key, label]) => (
              <div key={key} onClick={() => setTab(key)} style={{ padding: "10px 10px", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: "pointer", marginBottom: 3, background: tab === key ? COLORS.orange : "transparent", color: tab === key ? COLORS.sidebar : COLORS.textSecondary }}>{label}</div>
            ))}
            <div style={{ marginTop: 16, padding: "0 8px" }}>
              <Button onClick={runCheckinNow} disabled={checkinRunning}>{checkinRunning ? "Running…" : "Run check-in now"}</Button>
            </div>
          </>
        )}
      </div>

      <div style={{ flex: 1, padding: "24px 28px 40px", minWidth: 0 }}>
        {saving && <div style={{ position: "fixed", top: 12, right: 12, fontSize: 13, color: COLORS.textMuted }}>Saving…</div>}

        {tab === "dashboard" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <h1 style={{ ...H, fontSize: 34, margin: 0 }}>DASHBOARD</h1>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, color: COLORS.textSecondary }}>Monthly goal</span>
                <input type="number" value={data.goal} onChange={(e) => save({ ...data, goal: parseFloat(e.target.value) || 0 })}
                  style={{ width: 90, background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.orange}`, borderRadius: 8, color: COLORS.orange, fontFamily: "monospace", fontSize: 16, padding: "7px 10px", textAlign: "right" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <Card label="Current monthly income" value={`$${fmt(computed.totalMonthlyIncome)}`} accent={COLORS.orange} sub={`${fmt(progressPct, 0)}% of goal`} />
              <Card label="Portfolio value" value={`$${fmt(computed.totalMarketValue, 0)}`} sub={`Cost basis $${fmt(computed.totalCostBasis, 0)}`} />
              <Card label="Blended yield" value={`${fmt(computed.blendedAnnualYield)}%`} sub="Weighted, on current price" />
              <Card label="Next dividend" value={nextDivOverall ? nextDivOverall.id : "-"} accent={COLORS.green}
                sub={nextDivOverall ? `Ex ${nextDivOverall.exDate} · Pay ${nextDivOverall.payDate}${nextDivOverall.estimated ? " (est.)" : ""}` : "None on file"} />
              <Card label="SGD / MYR" value={fxLatest ? fmt(fxLatest.rate, 4) : "-"}
                accent={fxAbove ? COLORS.green : fxStale ? COLORS.amber : undefined}
                sub={!fxLatest ? "Run a check-in to load"
                  : fxStale ? `⚠️ Stale data (latest ${fxLatest.date})`
                  : fxHasAvg ? `${fxAbove ? "ABOVE ALERT LINE · " : ""}${fxLatest.deviationPct >= 0 ? "+" : ""}${fmt(fxLatest.deviationPct)}% vs ${fmt(fxLatest.avg, 4)} avg (alert at +${fmt(fxSettings.thresholdPct, 1)}%)`
                  : "Building rate history…"} />
            </div>

            <div style={{ marginBottom: 28 }}>
              <div style={{ height: 10, background: COLORS.surfaceRaised, borderRadius: 5, overflow: "hidden", border: `0.5px solid ${COLORS.border}` }}>
                <div style={{ height: "100%", width: `${progressPct}%`, background: COLORS.orange }} />
              </div>
              <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 6 }}>${fmt(computed.totalMonthlyIncome)} of ${fmt(data.goal, 0)} monthly income goal</div>
            </div>

            <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: 18, marginBottom: 28, fontSize: 14, color: COLORS.textMuted }}>
              AI advisor and dividend safety-read will appear here once the Anthropic API key is configured (see README).
            </div>

            <SectionTitle>Actual Progress</SectionTitle>
            <div style={{ marginBottom: 8 }}><Button onClick={logIncomeSnapshot}>Log this month's income (${fmt(computed.totalMonthlyIncome, 0)})</Button></div>
            <div style={{ height: 200, marginBottom: 28 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.incomeHistory || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: COLORS.textMuted, fontSize: 13 }} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 13 }} />
                  <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 13 }} />
                  <ReferenceLine y={data.goal} stroke={COLORS.red} strokeDasharray="4 4" />
                  <Bar dataKey="value" name="Monthly income" fill={COLORS.orange} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 28 }}>
              <div style={{ flex: "1 1 300px", minWidth: 280 }}>
                <SectionTitle>Income By Holding</SectionTitle>
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={diversification} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${fmt(percent * 100, 0)}%`} labelLine={false}>
                        {diversification.map((entry, i) => <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 13 }} formatter={(v) => `$${fmt(v)}/mo`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={{ flex: "1 1 300px", minWidth: 280 }}>
                <SectionTitle>Yield On Cost By Holding</SectionTitle>
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={yieldOnCostChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: COLORS.textMuted, fontSize: 13 }} />
                      <YAxis tick={{ fill: COLORS.textMuted, fontSize: 13 }} unit="%" />
                      <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 13 }} formatter={(v) => `${v}%`} />
                      <Bar dataKey="yoc" name="Yield on cost" fill={COLORS.green} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {yieldOnCostChart.length === 0 && <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 4 }}>No holdings with a cost basis yet.</div>}
              </div>
            </div>
          </>
        )}

        {tab === "portfolio" && (
          <>
            <h1 style={{ ...H, fontSize: 34, margin: "0 0 20px" }}>PORTFOLIO</h1>
            <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginBottom: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Record a purchase</div>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: COLORS.textSecondary }}>
                  Stock
                  <select value={buyTicker} onChange={(e) => setBuyTicker(e.target.value)} style={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontSize: 14, padding: "7px 8px", width: 120 }}>
                    <option value="">Select…</option>
                    {data.holdings.map((h) => <option key={h.uid} value={h.uid}>{h.id}</option>)}
                  </select>
                </label>
                <Field label="Quantity" value={buyQty} onChange={setBuyQty} width={90} />
                <Field label="Price paid" value={buyPrice} onChange={setBuyPrice} width={90} prefix="$" />
                <Button variant="orange" onClick={recordPurchase}>Record purchase</Button>
              </div>
              <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 10 }}>Don't see the stock you bought? Add it below in the holdings table first, then it'll appear in this dropdown.</div>
            </div>

            <SectionTitle>Holdings</SectionTitle>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 14 }}>
              "Payout %" (banks only) is the dividend payout ratio -- the % of earnings paid out as dividends. For U11/D05 it's a real sustainability signal: rising sharply toward 90-100% can mean the dividend is at risk if earnings dip, since less is being retained. It drives the Safety badge: under 75% = Covered, 75-95% = Watch, 95%+ = Tight. It's dropped for CLR/G3B -- S-REITs are legally required to distribute ~90%+ of income to keep their tax status, so a REIT's payout ratio sits near 100% by design and isn't a useful health signal the way it is for a bank. Not available from a free price feed -- ask Claude to check it after quarterly results, rather than looking it up yourself. Click a card for the full editable detail.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 12 }}>
              {computed.rows.map((r) => {
                const isBank = r.criteria?.type === "bank-pb";
                const flag = safetyFlag(r.payoutRatio);
                const isOpen = !!expandedHoldings[r.uid];
                const nextDiv = nextDivByTicker[r.id];
                return (
                  <div key={r.uid} style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
                    <div onClick={() => toggleExpanded(r.uid)} style={{ padding: 14, cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div>
                          <span style={{ color: COLORS.orange, fontFamily: "monospace", fontWeight: 600, fontSize: 15 }}>{r.id}</span>
                          <span style={{ color: COLORS.textSecondary, fontSize: 13, marginLeft: 8 }}>{r.name}</span>
                        </div>
                        {isBank ? <FlagBadge level={flag.level} text={flag.text} /> : <span style={{ fontSize: 12, color: COLORS.textMuted, fontStyle: "italic" }}>N/A (REIT)</span>}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, fontSize: 14, fontFamily: "monospace" }}>
                        <div><div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "sans-serif" }}>Shares held</div>{fmt(r.shares, 0)}</div>
                        <div><div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "sans-serif" }}>Market value</div>${fmt(r.marketValue, 0)}</div>
                        <div><div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "sans-serif" }}>Yield on cost</div><span style={{ color: COLORS.green }}>{r.yieldOnCost !== null ? `${fmt(r.yieldOnCost)}%` : "n/a"}</span></div>
                        <div style={{ gridColumn: "span 2" }}>
                          <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "sans-serif" }}>Total return</div>
                          <span style={{ color: r.totalReturnPct >= 0 ? COLORS.green : COLORS.red }}>{r.totalReturnPct !== null ? `${r.totalReturn >= 0 ? "+" : "-"}$${fmt(Math.abs(r.totalReturn), 0)} (${fmt(r.totalReturnPct, 1)}%)` : "n/a"}</span>
                        </div>
                        <div><div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "sans-serif" }}>Est. income/mo</div><span style={{ color: COLORS.orange }}>${fmt(r.monthlyIncome)}</span></div>
                      </div>
                      <div style={{ marginTop: 10, fontSize: 12, color: COLORS.textMuted, display: "flex", justifyContent: "space-between" }}>
                        <span>{isBank ? `Payout ratio: ${r.payoutRatio !== null && r.payoutRatio !== undefined && r.payoutRatio !== "" ? `${r.payoutRatio}%` : "no data"}` : "Payout ratio: n/a (REIT)"}</span>
                        <span>{isOpen ? "Hide details \u2303" : "Show details \u2304"}</span>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: COLORS.textMuted }}>
                        Next div: {nextDiv ? `ex ${nextDiv.exDate} \u00b7 pay ${nextDiv.payDate}${nextDiv.estimated ? " (est.)" : ""}` : "none on file"}
                      </div>
                    </div>

                    {isOpen && (
                      <div onClick={(e) => e.stopPropagation()} style={{ padding: 14, background: COLORS.surfaceRaised, borderTop: `0.5px solid ${COLORS.border}` }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                          <label style={{ fontSize: 11, color: COLORS.textSecondary }}>Ticker<TextCell value={r.id} onChange={(v) => updateHolding(r.uid, "id", v)} width={"100%"} /></label>
                          <label style={{ fontSize: 11, color: COLORS.textSecondary }}>Name<TextCell value={r.name} onChange={(v) => updateHolding(r.uid, "name", v)} width={"100%"} /></label>
                          <label style={{ fontSize: 11, color: COLORS.textSecondary }}>Shares<EditableCell value={r.shares} onChange={(v) => updateHolding(r.uid, "shares", v)} width={"100%"} /></label>
                          <label style={{ fontSize: 11, color: COLORS.textSecondary }}>Avg cost<EditableCell value={Math.round(r.avgCost * 10000) / 10000} onChange={(v) => updateHolding(r.uid, "avgCost", v)} width={"100%"} /></label>
                          <label style={{ fontSize: 11, color: COLORS.textSecondary }}>Current price<EditableCell value={r.price} onChange={(v) => updateHolding(r.uid, "price", v)} width={"100%"} /></label>
                          <label style={{ fontSize: 11, color: COLORS.textSecondary }}>Ann. div/share<EditableCell value={r.annualDiv} onChange={(v) => updateHolding(r.uid, "annualDiv", v)} width={"100%"} /></label>
                          <label style={{ fontSize: 11, color: COLORS.textSecondary }}>Payout ratio %<EditableCell value={r.payoutRatio ?? ""} onChange={(v) => updateHolding(r.uid, "payoutRatio", v)} width={"100%"} /></label>
                          <label style={{ fontSize: 11, color: COLORS.textSecondary }}>Total div recv (lifetime) $<EditableCell value={r.divReceived || 0} onChange={(v) => updateHolding(r.uid, "divReceived", v)} width={"100%"} /></label>
                        </div>
                        <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 12 }}>
                          Cost basis: ${fmt(r.costBasis, 0)} &nbsp;&middot;&nbsp; Current yield: {r.currentYield !== null ? `${fmt(r.currentYield)}%` : "-"}
                        </div>
                        <Button variant="ghost" onClick={() => removeHolding(r.uid)}>remove holding</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 16 }}>Total return = (Market value - Cost basis) + Dividends received. "Dividends received" only counts from when you start using "mark received" on the calendar going forward.</div>
            <div style={{ marginBottom: 28, display: "flex", gap: 10, alignItems: "center" }}>
              <select value={newStockPick} onChange={(e) => setNewStockPick(e.target.value)} style={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontSize: 14, padding: "8px 10px", width: 220 }}>
                <option value="">Select a ticker…</option>
                {Object.entries(TICKER_LOOKUP).map(([t, n]) => <option key={t} value={t}>{t} -- {n}</option>)}
                <option value="__custom__">Other (enter manually)</option>
              </select>
              <Button variant="orange" onClick={addHolding}>Add stock</Button>
            </div>

            <SectionTitle sub="Excluded from income tracking -- reward shares / illiquid">Other Holdings</SectionTitle>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 28 }}>
              <thead>
                <tr style={{ color: COLORS.textSecondary, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Ticker</th>
                  <th style={{ padding: "6px 8px" }}>Name</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Shares</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Price</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {(data.otherHoldings || []).map((h) => (
                  <tr key={h.uid} style={{ borderTop: `0.5px solid ${COLORS.border}` }}>
                    <td style={{ padding: "8px", fontFamily: "monospace", color: COLORS.textMuted }}>{h.id}</td>
                    <td style={{ padding: "8px", color: COLORS.textMuted }}>{h.name}</td>
                    <td style={{ padding: "8px", textAlign: "right", color: COLORS.textMuted, fontFamily: "monospace" }}>{h.shares} sh</td>
                    <td style={{ padding: "8px", textAlign: "right" }}><EditableCell value={h.price} onChange={(v) => updateOther(h.uid, "price", v)} /></td>
                    <td style={{ padding: "8px", textAlign: "right", color: COLORS.textMuted, fontFamily: "monospace" }}>${fmt(h.shares * h.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

          </>
        )}

        {tab === "gates" && (
          <>
            <h1 style={{ ...H, fontSize: 34, margin: "0 0 8px" }}>BUY CRITERIA</h1>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 20 }}>What each holding's Tier 1 / Tier 2 gates are actually seeing right now. Updates with each check-in.</div>

            <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.amber}`, borderRadius: 10, padding: 18, marginBottom: 28 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: COLORS.amber }}>Workflow: when CLR, U11, or D05 fires Tier 1/2</div>
              <div style={{ fontSize: 13, color: COLORS.textPrimary, lineHeight: 1.6 }}>
                Price/trend alone can't tell "cheap from sentiment" (fine to buy) apart from "cheap because the business is genuinely worth less" (a value trap) -- both can look identical on a chart. So the trend check no longer silently blocks these three; instead, whenever Tier 1/2 fires, <b>come back and ask Claude to check that trust/bank's actual fundamentals</b> (income trend, NAV, asset quality, any red flags) before buying. If a card below shows "Trend soft," treat that as a prompt to check, not an automatic no.
              </div>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 10 }}>G3B doesn't need this -- it's diversified across ~30 companies, so no single sector's problem defines the whole fund. Its criteria stay schedule/dip-based as before.</div>
            </div>

            <SectionTitle>Gate Reference</SectionTitle>
            <div style={{ overflowX: "auto", marginBottom: 32 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: COLORS.textSecondary, textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Holding</th>
                    <th style={{ padding: "6px 8px" }}>Tier 1 (moderate)</th>
                    <th style={{ padding: "6px 8px" }}>Tier 2 (confirmed / stronger)</th>
                    <th style={{ padding: "6px 8px" }}>Purchase type</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.rows.map((r) => {
                    const g = describeGates(r);
                    return (
                      <tr key={r.uid} style={{ borderTop: `0.5px solid ${COLORS.border}` }}>
                        <td style={{ padding: "8px", fontFamily: "monospace", color: COLORS.orange, verticalAlign: "top" }}>{r.id}</td>
                        <td style={{ padding: "8px", verticalAlign: "top" }}>{g.tier1}</td>
                        <td style={{ padding: "8px", verticalAlign: "top" }}>{g.tier2}</td>
                        <td style={{ padding: "8px", verticalAlign: "top", color: COLORS.textMuted }}>{g.purchase}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 28 }}>Generated live from each holding's actual configured thresholds, so it can't drift out of sync with what's really being checked. (There's no in-app editor for these yet -- ask me to adjust a threshold and I'll patch it.)</div>

            {computed.rows.map((r) => {
              const critType = r.criteria?.type;
              const tier1 = r.alertState?.tier1;
              const tier2 = r.alertState?.tier2;
              const TierBadge = ({ met, label }) => (
                <span style={{ background: met ? COLORS.greenSoft : COLORS.surfaceRaised, color: met ? COLORS.green : COLORS.textMuted, fontSize: 12, padding: "4px 12px", borderRadius: 12, fontWeight: 600 }}>{label}: {met ? "MET" : "not met"}</span>
              );

              let chart = null;
              if (critType === "bank-pb") {
                const avg = r.criteria.pbHistoricalAvg, bandLow = r.criteria.pbHistoricalBandLow;
                const series = pbSeries(r.priceHistory, r.bookValuePerShare).map((p) => ({ ...p, avg, bandLow }));
                chart = (
                  <div style={{ height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={series}>
                        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: COLORS.textMuted, fontSize: 11 }} minTickGap={40} />
                        <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} domain={["auto", "auto"]} />
                        <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} />
                        {bandLow != null && <ReferenceLine y={bandLow} stroke={COLORS.red} strokeDasharray="4 4" label={{ value: "Cheap band", fill: COLORS.red, fontSize: 11, position: "insideBottomLeft" }} />}
                        {avg != null && <ReferenceLine y={avg} stroke={COLORS.amber} strokeDasharray="4 4" label={{ value: "5yr average", fill: COLORS.amber, fontSize: 11, position: "insideTopLeft" }} />}
                        <Line type="monotone" dataKey="pb" name="P/B ratio" stroke={COLORS.orange} strokeWidth={2} dot={false} />
                        {avg != null && <Line type="monotone" dataKey="avg" name="5yr average" stroke={COLORS.amber} strokeWidth={1} strokeDasharray="4 4" dot={false} legendType="none" />}
                        {bandLow != null && <Line type="monotone" dataKey="bandLow" name="Cheap band" stroke={COLORS.red} strokeWidth={1} strokeDasharray="4 4" dot={false} legendType="none" />}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                );
              } else if (critType === "reit") {
                const yieldSeries = (r.yieldHistory || []).map((y) => (typeof y === "number" ? { date: "", yield: y } : y));
                const maSeries = rollingMASeries(r.priceHistory, r.criteria.maPeriod);
                const avgYield = yieldSeries.length ? yieldSeries.slice(-r.criteria.yieldLookbackQuarters).reduce((s, y) => s + y.yield, 0) / Math.min(yieldSeries.length, r.criteria.yieldLookbackQuarters) : null;
                const yieldSeriesWithAvg = yieldSeries.map((p) => ({ ...p, avgYield }));
                chart = (
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 260px", height: 200 }}>
                      <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Yield vs {r.criteria.yieldLookbackQuarters}-quarter average</div>
                      <ResponsiveContainer width="100%" height="90%">
                        <LineChart data={yieldSeriesWithAvg}>
                          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                          <XAxis dataKey="date" tick={{ fill: COLORS.textMuted, fontSize: 11 }} hide />
                          <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} unit="%" domain={["auto", "auto"]} />
                          <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} />
                          {avgYield != null && <ReferenceLine y={avgYield} stroke={COLORS.amber} strokeDasharray="4 4" label={{ value: "avg", fill: COLORS.amber, fontSize: 11 }} />}
                          <Line type="monotone" dataKey="yield" name="TTM yield" stroke={COLORS.green} strokeWidth={2} dot={{ r: 3 }} />
                          {avgYield != null && <Line type="monotone" dataKey="avgYield" name={`${r.criteria.yieldLookbackQuarters}Q average`} stroke={COLORS.amber} strokeWidth={1} strokeDasharray="4 4" dot={false} legendType="none" />}
                        </LineChart>
                      </ResponsiveContainer>
                      {yieldSeries.length < 2 && <div style={{ fontSize: 11, color: COLORS.textMuted }}>Builds a point each check-in -- needs more history yet.</div>}
                    </div>
                    <div style={{ flex: "1 1 260px", height: 200 }}>
                      <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Price vs {r.criteria.maPeriod}-day average</div>
                      <ResponsiveContainer width="100%" height="90%">
                        <LineChart data={maSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                          <XAxis dataKey="date" tick={{ fill: COLORS.textMuted, fontSize: 11 }} hide />
                          <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} domain={["auto", "auto"]} />
                          <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} />
                          <Line type="monotone" dataKey="price" name="Price" stroke={COLORS.orange} strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="ma" name={`${r.criteria.maPeriod}d avg`} stroke={COLORS.textMuted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              } else if (critType === "index-dca") {
                const maSeries = rollingMASeries(r.priceHistory, r.criteria.maPeriod);
                chart = (
                  <div style={{ height: 220 }}>
                    <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Price vs {r.criteria.maPeriod}-day average -- bonus buy triggers {r.criteria.bonusDipPct}%+ below</div>
                    <ResponsiveContainer width="100%" height="90%">
                      <LineChart data={maSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: COLORS.textMuted, fontSize: 11 }} minTickGap={40} />
                        <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} domain={["auto", "auto"]} />
                        <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} />
                        <Line type="monotone" dataKey="price" name="Price" stroke={COLORS.orange} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="ma" name={`${r.criteria.maPeriod}d avg`} stroke={COLORS.textMuted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                );
              } else if (r.priceHistory && r.priceHistory.length >= 5) {
                // No finalized buy criteria yet -- still show a real monitoring chart (200-day MA as a general default) rather than nothing
                const maSeries = rollingMASeries(r.priceHistory, 200);
                chart = (
                  <div style={{ height: 220 }}>
                    <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Price vs 200-day average -- monitoring only, no buy criteria set yet</div>
                    <ResponsiveContainer width="100%" height="90%">
                      <LineChart data={maSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: COLORS.textMuted, fontSize: 11 }} minTickGap={40} />
                        <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} domain={["auto", "auto"]} />
                        <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} />
                        <Line type="monotone" dataKey="price" name="Price" stroke={COLORS.orange} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="ma" name="200d avg" stroke={COLORS.textMuted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                );
              }

              return (
                <div key={r.uid} style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: 18, marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                    <div>
                      <span style={{ fontFamily: "monospace", color: COLORS.orange, fontWeight: 600, fontSize: 15 }}>{r.id}</span>
                      <span style={{ color: COLORS.textSecondary, marginLeft: 8, fontSize: 13 }}>{r.name}</span>
                    </div>
                    {critType ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <TierBadge met={tier1} label={r.criteria.type === "index-dca" ? "DCA" : "Tier 1"} />
                        <TierBadge met={tier2} label="Tier 2" />
                        {r.trendWeak && (r.criteria.type === "reit" || r.criteria.type === "bank-pb") && (
                          <span style={{ background: COLORS.amberSoft, color: COLORS.amber, fontSize: 11, padding: "4px 10px", borderRadius: 12, fontWeight: 600 }}>Trend soft -- check fundamentals</span>
                        )}
                        {(tier1 || tier2) && (
                          <Button variant="ghost" disabled={checkinRunning} onClick={() => resetAndRecheck(r.id)}>
                            {checkinRunning ? "…" : "Resend alert"}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: COLORS.textMuted, fontStyle: "italic" }}>No buy criteria configured for this holding</span>
                    )}
                  </div>
                  {chart}
                  {(!r.priceHistory || r.priceHistory.length < 5) && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 8 }}>Not enough price history yet -- builds automatically over the first few check-ins.</div>}
                </div>
              );
            })}
          </>
        )}

        {tab === "cashflow" && <Cashflow fx={data.fx} />}

        {tab === "strategy" && (
          <>
            <h1 style={{ ...H, fontSize: 34, margin: "0 0 8px" }}>STRATEGY</h1>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 24 }}>Your current working plan, for quick reference. Edit and save whenever it needs revising -- the saved version is what's shown here across sessions.</div>

            <SectionTitle sub={data.strategyUpdatedAt ? `Last updated ${data.strategyUpdatedAt}` : "Not yet saved"}>Current Strategy</SectionTitle>
            <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.orange}`, borderRadius: 10, padding: 20, marginBottom: 28, whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.7, color: COLORS.textPrimary }}>
              {data.strategyNotes || <span style={{ color: COLORS.textMuted, fontStyle: "italic" }}>No strategy saved yet -- edit the draft below and click Save.</span>}
            </div>

            <SectionTitle>Edit</SectionTitle>
            <textarea
              value={strategyDraft}
              onChange={(e) => { setStrategyDraft(e.target.value); setStrategySaved(false); }}
              rows={8}
              style={{ width: "100%", background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.textPrimary, fontSize: 14, padding: 12, fontFamily: "inherit", lineHeight: 1.6, boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
              <Button variant="orange" onClick={saveStrategy}>Save strategy</Button>
              {!strategySaved && <span style={{ fontSize: 12, color: COLORS.amber }}>Unsaved changes</span>}
              {strategySaved && data.strategyNotes === strategyDraft && <span style={{ fontSize: 12, color: COLORS.textMuted }}>Saved</span>}
            </div>

            <div style={{ marginTop: 40 }}>
              <SectionTitle sub="Telegram alert when SGD is unusually strong against MYR -- a good moment to convert extra. Rate source: Frankfurter (daily market reference rate). When it fires, still compare the final MYR amount in Wise and YouBiz before sending.">SGD / MYR Alert</SectionTitle>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
                <Field label="Alert when above 90-day average by (%)" value={fxSettings.thresholdPct} onChange={(v) => updateFxSetting("thresholdPct", v)} width={90} />
                <Field label="Monthly MYR spending (RM)" value={fxSettings.monthlySpendMYR} onChange={(v) => updateFxSetting("monthlySpendMYR", v)} width={110} prefix="RM" />
                <Field label="Months of spending to convert" value={fxSettings.monthsToConvert} onChange={(v) => updateFxSetting("monthsToConvert", v)} width={70} />
              </div>
              <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 10, lineHeight: 1.6 }}>
                {fxSuggestedSgd !== null ? `When the alert fires it suggests about S$${fmt(fxSuggestedSgd, 0)} (RM${fmt(fxSuggestedMyr, 0)}) at today's rate. ` : ""}
                After an alert you get a reminder every 3 days while the rate stays high, and a new alert only after it has been below the line for 7 days in a row. Changes apply from the next check-in.
              </div>
            </div>
          </>
        )}

        {tab === "journal" && (
          <>
            <h1 style={{ ...H, fontSize: 34, margin: "0 0 20px" }}>DECISION JOURNAL</h1>

            <SectionTitle sub={'Entries marked "est." are projected from last year\'s pattern -- verify closer to the date. Confirmed real dates are added automatically during check-ins.'}>Pending Dividends</SectionTitle>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 10 }}>
              <thead>
                <tr style={{ color: COLORS.textSecondary, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Ticker</th><th style={{ padding: "6px 8px" }}>Ex-date</th><th style={{ padding: "6px 8px" }}>Pay date</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Per share</th><th style={{ padding: "6px 8px", textAlign: "right" }}>App estimate</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Actual $ (optional)</th><th></th><th></th>
                </tr>
              </thead>
              <tbody>
                {upcomingCalendar.map((d) => {
                  const h = data.holdings.find((x) => x.id === d.id);
                  const cash = h ? h.shares * d.perShare : 0;
                  return (
                    <tr key={d.uid} style={{ borderTop: `0.5px solid ${COLORS.border}` }}>
                      <td style={{ padding: "8px", fontFamily: "monospace", color: COLORS.orange }}>{d.id}</td>
                      <td style={{ padding: "8px" }}>{d.exDate}</td>
                      <td style={{ padding: "8px" }}>{d.payDate}</td>
                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace" }}>{fmt(d.perShare, 4)}</td>
                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: COLORS.textMuted }}>${fmt(cash)}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>
                        <input type="number" step="any" placeholder="if different" value={actualAmounts[d.uid] ?? ""} onChange={(e) => setActualAmounts((prev) => ({ ...prev, [d.uid]: e.target.value }))}
                          style={{ width: 100, background: "transparent", border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontFamily: "monospace", fontSize: 14, padding: "5px 7px", textAlign: "right" }} />
                      </td>
                      <td style={{ padding: "8px" }}>{d.estimated && <FlagBadge level="amber" text="est." />}</td>
                      <td style={{ padding: "8px" }}>
                        <Button variant="ghost" onClick={() => markReceived(d)}>mark received</Button>
                      </td>
                    </tr>
                  );
                })}
                {upcomingCalendar.length === 0 && <tr><td colSpan={8} style={{ padding: "16px 8px", color: COLORS.textMuted, fontStyle: "italic" }}>No upcoming distributions logged.</td></tr>}
              </tbody>
            </table>
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 24 }}>
              Leave "Actual $" blank to accept the app's estimate. Enter the real amount that actually hit your account and the app will flag it in the log below if it differs from the estimate by more than 5% -- that's the check that catches a data bug early instead of months later.
            </div>

            <SectionTitle>Recently Received</SectionTitle>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 28 }}>
              <thead><tr style={{ color: COLORS.textSecondary, textAlign: "left" }}><th style={{ padding: "6px 8px" }}>Ticker</th><th style={{ padding: "6px 8px" }}>Received</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Cash</th></tr></thead>
              <tbody>
                {(data.divHistory || []).length === 0 && <tr><td colSpan={3} style={{ padding: "12px 8px", color: COLORS.textMuted, fontStyle: "italic" }}>None yet -- use "mark received" above once a distribution is actually paid.</td></tr>}
                {(data.divHistory || []).slice(0, 10).map((h, i) => (
                  <tr key={i} style={{ borderTop: `0.5px solid ${COLORS.border}` }}>
                    <td style={{ padding: "8px", fontFamily: "monospace", color: COLORS.orange }}>{h.id}</td>
                    <td style={{ padding: "8px" }}>{h.date}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: COLORS.green }}>${fmt(h.cash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <SectionTitle>Log</SectionTitle>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input type="text" value={newAlert} onChange={(e) => setNewAlert(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addAlert()}
                placeholder="Log a decision" style={{ flex: 1, background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.textPrimary, fontSize: 14, padding: "8px 12px" }} />
              <Button variant="orange" onClick={addAlert}>Add</Button>
            </div>
            {(data.alertLog || []).map((a, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: `0.5px solid ${COLORS.border}`, fontSize: 14 }}>
                <div><span style={{ color: COLORS.textMuted, fontFamily: "monospace", marginRight: 10 }}>{a.date}</span>{a.text}</div>
                <Button variant="ghost" onClick={() => removeAlert(i)}>remove</Button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
