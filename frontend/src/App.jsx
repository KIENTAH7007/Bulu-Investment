import React, { useState, useEffect, useMemo, useCallback } from "react";
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
};
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
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [newAlert, setNewAlert] = useState("");
  const [buyTicker, setBuyTicker] = useState("");
  const [buyQty, setBuyQty] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [checkinRunning, setCheckinRunning] = useState(false);
  const [watchPick, setWatchPick] = useState("");
  const [newStockPick, setNewStockPick] = useState("");

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
      setLoading(false);
    }).catch((e) => { console.error(e); setLoading(false); });
  }, []);

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
  const updateWatch = (uid, field, value) => save({ ...data, watchlist: data.watchlist.map((w) => w.uid === uid ? { ...w, [field]: value } : w) });
  const removeWatch = (uid) => save({ ...data, watchlist: data.watchlist.filter((w) => w.uid !== uid) });
  const addWatch = () => {
    if (!watchPick) return;
    const uid = `w-${Date.now()}`;
    if (watchPick === "__custom__") {
      save({ ...data, watchlist: [...data.watchlist, { uid, id: "TICK", name: "New ticker", price: 0, notes: "", priceHistory: [] }] });
    } else {
      save({ ...data, watchlist: [...data.watchlist, { uid, id: watchPick, name: TICKER_LOOKUP[watchPick] || watchPick, price: 0, notes: "", priceHistory: [] }] });
    }
    setWatchPick("");
  };
  const logWatchPrice = (uid) => {
    const todayStr = todayISO();
    save({
      ...data,
      watchlist: data.watchlist.map((w) => w.uid === uid
        ? { ...w, priceHistory: [...(w.priceHistory || []).filter((h) => h.date !== todayStr), { date: todayStr, close: w.price }] }
        : w),
    });
  };

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
    const cash = h.shares * entry.perShare;
    save({
      ...data,
      holdings: data.holdings.map((x) => x.id === h.id ? { ...x, divReceived: (x.divReceived || 0) + cash } : x),
      dividendCalendar: data.dividendCalendar.filter((d) => d.uid !== entry.uid),
      divHistory: [{ id: entry.id, date: todayISO(), cash }, ...(data.divHistory || [])],
      alertLog: [{ date: todayISO(), text: `Received $${fmt(cash)} dividend from ${entry.id}` }, ...data.alertLog],
    });
  };
  const addCalendarEntry = () => save({ ...data, dividendCalendar: [...data.dividendCalendar, { uid: `d-new-${Date.now()}`, id: data.holdings[0]?.id || "", exDate: todayISO(), payDate: todayISO(), perShare: 0, estimated: true }] });
  const updateCalendar = (uid, field, value) => save({ ...data, dividendCalendar: data.dividendCalendar.map((d) => d.uid === uid ? { ...d, [field]: value } : d) });
  const removeCalendarEntry = (uid) => save({ ...data, dividendCalendar: data.dividendCalendar.filter((d) => d.uid !== uid) });
  const clearEmptyCalendarEntries = () => save({ ...data, dividendCalendar: data.dividendCalendar.filter((d) => d.perShare > 0) });

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
    const today = new Date(); const windowEnd = new Date(); windowEnd.setDate(today.getDate() + 60);
    const upcomingDivCash = (data.dividendCalendar || [])
      .filter((d) => new Date(d.payDate) >= today && new Date(d.payDate) <= windowEnd)
      .reduce((s, d) => { const h = data.holdings.find((x) => x.id === d.id); return s + (h ? h.shares * d.perShare : 0); }, 0);
    const dryPowder = (data.monthlyDCA || 0) + upcomingDivCash + (data.extraCash || 0);
    return { rows, totalMarketValue, totalMonthlyIncome, totalCostBasis, blendedAnnualYield, upcomingDivCash, dryPowder };
  }, [data]);

  const diversification = useMemo(() => computed ? computed.rows.filter((r) => r.monthlyIncome > 0).map((r) => ({ name: r.id, value: Math.round(r.monthlyIncome * 100) / 100 })) : [], [computed]);
  const yieldOnCostChart = useMemo(() => computed ? computed.rows.filter((r) => r.yieldOnCost !== null).map((r) => ({ name: r.id, yoc: Math.round(r.yieldOnCost * 100) / 100 })) : [], [computed]);
  const upcomingCalendar = useMemo(() => {
    if (!data) return [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return [...(data.dividendCalendar || [])].filter((d) => new Date(d.payDate) >= today).sort((a, b) => new Date(a.payDate) - new Date(b.payDate));
  }, [data]);
  const calendarChartData = useMemo(() => {
    if (!data) return [];
    const months = {};
    upcomingCalendar.forEach((d) => {
      const h = data.holdings.find((x) => x.id === d.id);
      if (!h) return;
      const key = d.payDate.slice(0, 7);
      months[key] = (months[key] || 0) + h.shares * d.perShare;
    });
    return Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).map(([month, cash]) => ({ month, cash: Math.round(cash * 100) / 100 }));
  }, [upcomingCalendar, data]);

  if (loading || !data || !computed) return <div style={{ color: COLORS.textSecondary, padding: 40, fontFamily: "sans-serif", background: COLORS.bg, minHeight: "100vh" }}>Loading dashboard…</div>;

  const progressPct = Math.min(100, (computed.totalMonthlyIncome / data.goal) * 100);
  const navItems = [["dashboard", "Dashboard"], ["portfolio", "Portfolio"], ["gates", "Buy Criteria"], ["watchlist", "Watchlist"], ["calendar", "Dividend Calendar"], ["journal", "Journal"]];

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
              <Card label="Dry powder next 60d" value={`$${fmt(computed.dryPowder, 0)}`} accent={COLORS.green} sub="DCA + dividends + extra" />
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

            <SectionTitle>Expected Cash By Month</SectionTitle>
            <div style={{ height: 200, marginBottom: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={calendarChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: COLORS.textMuted, fontSize: 13 }} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 13 }} />
                  <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 13 }} formatter={(v) => `$${v}`} />
                  <Bar dataKey="cash" name="Expected cash" fill={COLORS.green} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {calendarChartData.length === 0 && <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 20 }}>No upcoming distributions to chart yet.</div>}
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
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 10 }}>
              "Payout %" is the dividend payout ratio -- the % of a company's earnings paid out as dividends. Not available from free price feeds, so type it in yourself when you know it (check the company's latest results). It drives the Safety badge: under 75% = Covered, 75-95% = Watch, 95%+ = Tight.
            </div>
            <div style={{ overflowX: "auto", marginBottom: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ color: COLORS.textSecondary, textAlign: "right" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Ticker / name</th>
                    <th style={{ padding: "6px 8px" }}>Shares / avg cost</th>
                    <th style={{ padding: "6px 8px" }}>Price / ann. div</th>
                    <th style={{ padding: "6px 8px" }}>Value (mkt / cost)</th>
                    <th style={{ padding: "6px 8px" }}>Yield (on cost / now)</th>
                    <th style={{ padding: "6px 8px" }}>Total return</th>
                    <th style={{ padding: "6px 8px" }}>Est. $/mo</th>
                    <th style={{ padding: "6px 8px" }}>Payout % / safety</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {computed.rows.map((r) => {
                    const flag = safetyFlag(r.payoutRatio);
                    return (
                      <tr key={r.uid} style={{ borderTop: `0.5px solid ${COLORS.border}` }}>
                        <td style={{ padding: "8px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <TextCell value={r.id} onChange={(v) => updateHolding(r.uid, "id", v)} width={100} />
                            <TextCell value={r.name} onChange={(v) => updateHolding(r.uid, "name", v)} width={140} />
                          </div>
                        </td>
                        <td style={{ padding: "8px", textAlign: "right" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
                            <EditableCell value={r.shares} onChange={(v) => updateHolding(r.uid, "shares", v)} width={90} />
                            <EditableCell value={r.avgCost} onChange={(v) => updateHolding(r.uid, "avgCost", v)} width={90} />
                          </div>
                        </td>
                        <td style={{ padding: "8px", textAlign: "right" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
                            <EditableCell value={r.price} onChange={(v) => updateHolding(r.uid, "price", v)} width={80} />
                            <EditableCell value={r.annualDiv} onChange={(v) => updateHolding(r.uid, "annualDiv", v)} width={80} />
                          </div>
                        </td>
                        <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace" }}>
                          <div>${fmt(r.marketValue, 0)}</div>
                          <div style={{ color: COLORS.textMuted, fontSize: 13 }}>${fmt(r.costBasis, 0)}</div>
                        </td>
                        <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace" }}>
                          <div style={{ color: COLORS.green }}>{r.yieldOnCost !== null ? `${fmt(r.yieldOnCost)}%` : "n/a"}</div>
                          <div style={{ color: COLORS.textMuted, fontSize: 13 }}>{r.currentYield !== null ? `${fmt(r.currentYield)}%` : "-"}</div>
                        </td>
                        <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: r.totalReturnPct >= 0 ? COLORS.green : COLORS.red }}>
                          {r.totalReturnPct !== null ? <><div>{r.totalReturn >= 0 ? "+" : "-"}${fmt(Math.abs(r.totalReturn), 0)}</div><div style={{ fontSize: 13, opacity: 0.8 }}>({r.totalReturnPct >= 0 ? "+" : ""}{fmt(r.totalReturnPct, 1)}%)</div></> : "n/a"}
                        </td>
                        <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: COLORS.orange }}>${fmt(r.monthlyIncome)}</td>
                        <td style={{ padding: "8px", textAlign: "right" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                            <EditableCell value={r.payoutRatio ?? ""} onChange={(v) => updateHolding(r.uid, "payoutRatio", v)} width={55} />
                            <FlagBadge level={flag.level} text={flag.text} />
                          </div>
                        </td>
                        <td style={{ padding: "8px" }}><Button variant="ghost" onClick={() => removeHolding(r.uid)}>remove</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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

            <SectionTitle>Dry Powder</SectionTitle>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px", flex: "1 1 160px" }}>
                <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 8, textTransform: "uppercase" }}>Planned DCA</div>
                <input type="number" value={data.monthlyDCA} onChange={(e) => save({ ...data, monthlyDCA: parseFloat(e.target.value) || 0 })}
                  style={{ width: "100%", background: "transparent", border: "none", color: COLORS.textPrimary, fontFamily: "monospace", fontSize: 22, padding: 0 }} />
              </div>
              <Card label="Upcoming dividend cash (auto, 60d)" value={`$${fmt(computed.upcomingDivCash)}`} accent={COLORS.green} />
              <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px", flex: "1 1 160px" }}>
                <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 8, textTransform: "uppercase" }}>Extra cash</div>
                <input type="number" value={data.extraCash} onChange={(e) => save({ ...data, extraCash: parseFloat(e.target.value) || 0 })}
                  style={{ width: "100%", background: "transparent", border: "none", color: COLORS.textPrimary, fontFamily: "monospace", fontSize: 22, padding: 0 }} />
              </div>
              <Card label="Total available" value={`$${fmt(computed.dryPowder)}`} accent={COLORS.orange} />
            </div>
          </>
        )}

        {tab === "gates" && (
          <>
            <h1 style={{ ...H, fontSize: 34, margin: "0 0 8px" }}>BUY CRITERIA</h1>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 24 }}>What each holding's Tier 1 / Tier 2 gates are actually seeing right now. Updates with each check-in.</div>

            {computed.rows.map((r) => {
              const critType = r.criteria?.type;
              const tier1 = r.alertState?.tier1;
              const tier2 = r.alertState?.tier2;
              const TierBadge = ({ met, label }) => (
                <span style={{ background: met ? COLORS.greenSoft : COLORS.surfaceRaised, color: met ? COLORS.green : COLORS.textMuted, fontSize: 12, padding: "4px 12px", borderRadius: 12, fontWeight: 600 }}>{label}: {met ? "MET" : "not met"}</span>
              );

              let chart = null;
              if (critType === "bank-pb") {
                const series = pbSeries(r.priceHistory, r.bookValuePerShare);
                const avg = r.criteria.pbHistoricalAvg, bandLow = r.criteria.pbHistoricalBandLow;
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
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                );
              } else if (critType === "reit") {
                const yieldSeries = (r.yieldHistory || []).map((y) => (typeof y === "number" ? { date: "", yield: y } : y));
                const maSeries = rollingMASeries(r.priceHistory, r.criteria.maPeriod);
                const avgYield = yieldSeries.length ? yieldSeries.slice(-r.criteria.yieldLookbackQuarters).reduce((s, y) => s + y.yield, 0) / Math.min(yieldSeries.length, r.criteria.yieldLookbackQuarters) : null;
                chart = (
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 260px", height: 200 }}>
                      <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Yield vs {r.criteria.yieldLookbackQuarters}-quarter average</div>
                      <ResponsiveContainer width="100%" height="90%">
                        <LineChart data={yieldSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                          <XAxis dataKey="date" tick={{ fill: COLORS.textMuted, fontSize: 11 }} hide />
                          <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} unit="%" domain={["auto", "auto"]} />
                          <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} />
                          {avgYield != null && <ReferenceLine y={avgYield} stroke={COLORS.amber} strokeDasharray="4 4" label={{ value: "avg", fill: COLORS.amber, fontSize: 11 }} />}
                          <Line type="monotone" dataKey="yield" name="TTM yield" stroke={COLORS.green} strokeWidth={2} dot={{ r: 3 }} />
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
              }

              return (
                <div key={r.uid} style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: 18, marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                    <div>
                      <span style={{ fontFamily: "monospace", color: COLORS.orange, fontWeight: 600, fontSize: 15 }}>{r.id}</span>
                      <span style={{ color: COLORS.textSecondary, marginLeft: 8, fontSize: 13 }}>{r.name}</span>
                    </div>
                    {critType ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <TierBadge met={tier1} label={r.criteria.type === "index-dca" ? "DCA" : "Tier 1"} />
                        <TierBadge met={tier2} label="Tier 2" />
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

        {tab === "watchlist" && (
          <>
            <h1 style={{ ...H, fontSize: 34, margin: "0 0 20px" }}>WATCHLIST</h1>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 20 }}>Price history builds automatically from real check-ins. "Log price" lets you add a point yourself in between.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(280px, 1fr))", gap: 16, marginBottom: 20 }}>
              {data.watchlist.map((w) => (
                <div key={w.uid} style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div>
                      <TextCell value={w.id} onChange={(v) => updateWatch(w.uid, "id", v)} width={60} />
                      <div style={{ marginTop: 4 }}><TextCell value={w.name} onChange={(v) => updateWatch(w.uid, "name", v)} width={160} /></div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ color: COLORS.textMuted }}>$</span>
                      <EditableCell value={w.price} onChange={(v) => updateWatch(w.uid, "price", v)} width={70} />
                    </div>
                  </div>
                  <div style={{ height: 100 }}>
                    {(w.priceHistory || []).length >= 2 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={w.priceHistory}>
                          <XAxis dataKey="date" tick={{ fill: COLORS.textMuted, fontSize: 11 }} hide />
                          <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} domain={["auto", "auto"]} />
                          <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, fontSize: 13 }} />
                          <Line type="monotone" dataKey="close" stroke={COLORS.orange} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : <div style={{ fontSize: 13, color: COLORS.textMuted, textAlign: "center", paddingTop: 40 }}>No price history yet -- log a snapshot or wait for the next check-in</div>}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                    <TextCell value={w.notes} onChange={(v) => updateWatch(w.uid, "notes", v)} width={140} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button onClick={() => logWatchPrice(w.uid)}>Log price</Button>
                      <Button variant="ghost" onClick={() => removeWatch(w.uid)}>remove</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <select value={watchPick} onChange={(e) => setWatchPick(e.target.value)} style={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontSize: 14, padding: "8px 10px", width: 220 }}>
                <option value="">Select a ticker…</option>
                {Object.entries(TICKER_LOOKUP).map(([t, n]) => <option key={t} value={t}>{t} -- {n}</option>)}
                <option value="__custom__">Other (enter manually)</option>
              </select>
              <Button variant="orange" onClick={addWatch}>Add to watchlist</Button>
            </div>
          </>
        )}

        {tab === "calendar" && (
          <>
            <h1 style={{ ...H, fontSize: 34, margin: "0 0 20px" }}>DIVIDEND CALENDAR</h1>
            <div style={{ fontSize: 14, color: COLORS.textSecondary, marginBottom: 16 }}>Showing upcoming ex-dates and pay-dates only. Entries marked "est." are projected -- verify closer to the date. During check-ins, Claude adds real dividends.sg data here automatically.</div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 16 }}>
              <thead>
                <tr style={{ color: COLORS.textSecondary, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Ticker</th><th style={{ padding: "6px 8px" }}>Ex-date</th><th style={{ padding: "6px 8px" }}>Pay date</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Per share</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Expected cash</th><th></th><th></th>
                </tr>
              </thead>
              <tbody>
                {upcomingCalendar.map((d) => {
                  const h = data.holdings.find((x) => x.id === d.id);
                  const cash = h ? h.shares * d.perShare : 0;
                  return (
                    <tr key={d.uid} style={{ borderTop: `0.5px solid ${COLORS.border}` }}>
                      <td style={{ padding: "8px" }}><TextCell value={d.id} onChange={(v) => updateCalendar(d.uid, "id", v)} width={60} /></td>
                      <td style={{ padding: "8px" }}><input type="date" value={d.exDate} onChange={(e) => updateCalendar(d.uid, "exDate", e.target.value)} style={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontSize: 14, padding: "5px 7px" }} /></td>
                      <td style={{ padding: "8px" }}><input type="date" value={d.payDate} onChange={(e) => updateCalendar(d.uid, "payDate", e.target.value)} style={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontSize: 14, padding: "5px 7px" }} /></td>
                      <td style={{ padding: "8px", textAlign: "right" }}><EditableCell value={d.perShare} onChange={(v) => updateCalendar(d.uid, "perShare", v)} /></td>
                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: COLORS.orange }}>${fmt(cash)}</td>
                      <td style={{ padding: "8px" }}>{d.estimated && <FlagBadge level="amber" text="est." />}</td>
                      <td style={{ padding: "8px", display: "flex", gap: 6 }}>
                        <Button variant="ghost" onClick={() => markReceived(d)}>mark received</Button>
                        <Button variant="ghost" onClick={() => removeCalendarEntry(d.uid)}>remove</Button>
                      </td>
                    </tr>
                  );
                })}
                {upcomingCalendar.length === 0 && <tr><td colSpan={7} style={{ padding: "16px 8px", color: COLORS.textMuted, fontStyle: "italic" }}>No upcoming distributions logged.</td></tr>}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
              <Button onClick={addCalendarEntry}>Add entry</Button>
              <Button variant="ghost" onClick={clearEmptyCalendarEntries}>Clear empty entries ($0 per share)</Button>
            </div>

            <SectionTitle>Recently Received</SectionTitle>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ color: COLORS.textSecondary, textAlign: "left" }}><th style={{ padding: "6px 8px" }}>Ticker</th><th style={{ padding: "6px 8px" }}>Received</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Cash</th></tr></thead>
              <tbody>
                {(data.divHistory || []).length === 0 && <tr><td colSpan={3} style={{ padding: "12px 8px", color: COLORS.textMuted, fontStyle: "italic" }}>None yet -- use "mark received" above once a distribution is actually paid.</td></tr>}
                {(data.divHistory || []).map((h, i) => (
                  <tr key={i} style={{ borderTop: `0.5px solid ${COLORS.border}` }}>
                    <td style={{ padding: "8px", fontFamily: "monospace", color: COLORS.orange }}>{h.id}</td>
                    <td style={{ padding: "8px" }}>{h.date}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: COLORS.green }}>${fmt(h.cash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {tab === "journal" && (
          <>
            <h1 style={{ ...H, fontSize: 34, margin: "0 0 20px" }}>DECISION JOURNAL</h1>
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
