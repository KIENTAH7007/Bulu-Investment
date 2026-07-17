import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
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

function fmt(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toLocaleString("en-SG", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

function Card({ label, value, sub, accent }) {
  return (
    <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px", flex: "1 1 160px", minWidth: 150 }}>
      <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 500, color: accent || COLORS.textPrimary }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h2 style={{ ...H, fontWeight: 400, fontSize: 22, color: COLORS.textPrimary, margin: 0, textTransform: "uppercase" }}>{children}</h2>
      {sub && <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function EditableCell({ value, onChange, width = 70 }) {
  return <input type="number" step="any" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
    style={{ width, background: "transparent", border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontFamily: "monospace", fontSize: 13, padding: "5px 7px", textAlign: "right" }} />;
}
function TextCell({ value, onChange, width = 110 }) {
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
    style={{ width, background: "transparent", border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontSize: 13, padding: "5px 7px" }} />;
}
function Field({ label, value, onChange, width = 100, prefix }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: COLORS.textSecondary }}>
      {label}
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {prefix && <span style={{ color: COLORS.textMuted }}>{prefix}</span>}
        <input type="number" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          style={{ width, background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontFamily: "monospace", fontSize: 13, padding: "6px 8px", textAlign: "right" }} />
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
  return <button onClick={onClick} disabled={disabled} style={{ ...styles[variant], borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>{children}</button>;
}
function FlagBadge({ level, text }) {
  const map = { green: { bg: COLORS.greenSoft, color: COLORS.green }, amber: { bg: COLORS.amberSoft, color: COLORS.amber }, red: { bg: COLORS.redSoft, color: COLORS.red }, none: { bg: COLORS.surfaceRaised, color: COLORS.textMuted } };
  const s = map[level] || map.none;
  return <span style={{ background: s.bg, color: s.color, fontSize: 11, padding: "3px 9px", borderRadius: 12, fontWeight: 600 }}>{text}</span>;
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

  useEffect(() => {
    fetch("/api/data").then((r) => r.json()).then((d) => { setData(d); setLoading(false); })
      .catch((e) => { console.error(e); setLoading(false); });
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

  const updateHolding = (id, field, value) => save({ ...data, holdings: data.holdings.map((h) => h.id === id ? { ...h, [field]: value } : h) });
  const updateOther = (id, field, value) => save({ ...data, otherHoldings: data.otherHoldings.map((h) => h.id === id ? { ...h, [field]: value } : h) });
  const updateWatch = (id, field, value) => save({ ...data, watchlist: data.watchlist.map((w) => w.id === id ? { ...w, [field]: value } : w) });
  const removeWatch = (id) => save({ ...data, watchlist: data.watchlist.filter((w) => w.id !== id) });
  const addWatch = () => save({ ...data, watchlist: [...data.watchlist, { id: "TICK", name: "New ticker", price: 0, notes: "", priceHistory: [] }] });

  const addAlert = () => {
    if (!newAlert.trim()) return;
    save({ ...data, alertLog: [{ date: todayISO(), text: newAlert.trim() }, ...data.alertLog] });
    setNewAlert("");
  };
  const removeAlert = (idx) => { const next = [...data.alertLog]; next.splice(idx, 1); save({ ...data, alertLog: next }); };

  const recordPurchase = () => {
    const qty = parseFloat(buyQty), price = parseFloat(buyPrice);
    if (!buyTicker || !qty || !price) return;
    const h = data.holdings.find((x) => x.id === buyTicker);
    if (!h) return;
    const newShares = h.shares + qty;
    const newAvgCost = newShares > 0 ? ((h.shares * h.avgCost) + (qty * price)) / newShares : 0;
    save({
      ...data,
      holdings: data.holdings.map((x) => x.id === buyTicker ? { ...x, shares: newShares, avgCost: newAvgCost, price } : x),
      alertLog: [{ date: todayISO(), text: `Bought ${qty} ${buyTicker} at $${price} -- new avg cost $${fmt(newAvgCost, 3)}` }, ...data.alertLog],
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
      dividendCalendar: data.dividendCalendar.filter((d) => d !== entry),
      alertLog: [{ date: todayISO(), text: `Received $${fmt(cash)} dividend from ${entry.id}` }, ...data.alertLog],
    });
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
    const today = new Date(); const windowEnd = new Date(); windowEnd.setDate(today.getDate() + 60);
    const upcomingDivCash = (data.dividendCalendar || [])
      .filter((d) => new Date(d.payDate) >= today && new Date(d.payDate) <= windowEnd)
      .reduce((s, d) => { const h = data.holdings.find((x) => x.id === d.id); return s + (h ? h.shares * d.perShare : 0); }, 0);
    const dryPowder = (data.monthlyDCA || 0) + upcomingDivCash + (data.extraCash || 0);
    return { rows, totalMarketValue, totalMonthlyIncome, totalCostBasis, blendedAnnualYield, upcomingDivCash, dryPowder };
  }, [data]);

  const diversification = useMemo(() => computed ? computed.rows.filter((r) => r.monthlyIncome > 0).map((r) => ({ name: r.id, value: Math.round(r.monthlyIncome * 100) / 100 })) : [], [computed]);
  const upcomingCalendar = useMemo(() => {
    if (!data) return [];
    const today = new Date();
    return [...(data.dividendCalendar || [])].filter((d) => new Date(d.payDate) >= today).sort((a, b) => new Date(a.payDate) - new Date(b.payDate));
  }, [data]);

  if (loading || !data || !computed) return <div style={{ color: COLORS.textSecondary, padding: 40, fontFamily: "sans-serif", background: COLORS.bg, minHeight: "100vh" }}>Loading dashboard…</div>;

  const progressPct = Math.min(100, (computed.totalMonthlyIncome / data.goal) * 100);
  const navItems = [["dashboard", "Dashboard"], ["portfolio", "Portfolio"], ["watchlist", "Watchlist"], ["calendar", "Dividend Calendar"], ["journal", "Journal"]];

  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", color: COLORS.textPrimary, fontFamily: "sans-serif", display: "flex" }}>
      <div style={{ width: sidebarOpen ? 200 : 52, background: COLORS.sidebar, padding: sidebarOpen ? "20px 12px" : "20px 8px", flexShrink: 0, transition: "width 0.2s" }}>
        <div onClick={() => setSidebarOpen(!sidebarOpen)} style={{ cursor: "pointer", fontSize: 18, color: COLORS.textSecondary, marginBottom: 18, padding: "0 4px" }}>☰</div>
        {sidebarOpen && (
          <>
            <div style={{ ...H, fontSize: 15, color: COLORS.orange, marginBottom: 2, padding: "0 8px" }}>BULU FAMILY</div>
            <div style={{ ...H, fontSize: 22, marginBottom: 8, padding: "0 8px", color: COLORS.cream }}>INVESTMENT</div>
            <div style={{ fontSize: 10, color: COLORS.textMuted, padding: "0 8px", marginBottom: 18 }}>
              {data.lastCheckin ? `Last check-in: ${new Date(data.lastCheckin.at).toLocaleString("en-SG")}` : "No check-in yet"}
            </div>
            {navItems.map(([key, label]) => (
              <div key={key} onClick={() => setTab(key)} style={{ padding: "10px 10px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", marginBottom: 3, background: tab === key ? COLORS.orange : "transparent", color: tab === key ? COLORS.sidebar : COLORS.textSecondary }}>{label}</div>
            ))}
            <div style={{ marginTop: 16, padding: "0 8px" }}>
              <Button onClick={runCheckinNow} disabled={checkinRunning}>{checkinRunning ? "Running…" : "Run check-in now"}</Button>
            </div>
          </>
        )}
      </div>

      <div style={{ flex: 1, padding: "24px 28px 40px", minWidth: 0 }}>
        {saving && <div style={{ position: "fixed", top: 12, right: 12, fontSize: 11, color: COLORS.textMuted }}>Saving…</div>}

        {tab === "dashboard" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <h1 style={{ ...H, fontSize: 34, margin: 0 }}>DASHBOARD</h1>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, color: COLORS.textSecondary }}>Monthly goal</span>
                <input type="number" value={data.goal} onChange={(e) => save({ ...data, goal: parseFloat(e.target.value) || 0 })}
                  style={{ width: 90, background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.orange}`, borderRadius: 8, color: COLORS.orange, fontFamily: "monospace", fontSize: 15, padding: "7px 10px", textAlign: "right" }} />
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
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 6 }}>${fmt(computed.totalMonthlyIncome)} of ${fmt(data.goal, 0)} monthly income goal</div>
            </div>

            <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: 18, marginBottom: 28, fontSize: 13, color: COLORS.textMuted }}>
              AI advisor and dividend safety-read will appear here once the Anthropic API key is configured (see README).
            </div>

            <SectionTitle>Actual Progress</SectionTitle>
            <div style={{ marginBottom: 8 }}><Button onClick={logIncomeSnapshot}>Log this month's income (${fmt(computed.totalMonthlyIncome, 0)})</Button></div>
            <div style={{ height: 200, marginBottom: 28 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.incomeHistory || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} />
                  <ReferenceLine y={data.goal} stroke={COLORS.red} strokeDasharray="4 4" />
                  <Bar dataKey="value" name="Monthly income" fill={COLORS.orange} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <SectionTitle>Income By Holding</SectionTitle>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={diversification} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${fmt(percent * 100, 0)}%`} labelLine={false}>
                    {diversification.map((entry, i) => <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v) => `$${fmt(v)}/mo`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {tab === "portfolio" && (
          <>
            <h1 style={{ ...H, fontSize: 34, margin: "0 0 20px" }}>PORTFOLIO</h1>
            <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Record a purchase</div>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: COLORS.textSecondary }}>
                  Stock
                  <select value={buyTicker} onChange={(e) => setBuyTicker(e.target.value)} style={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontSize: 13, padding: "7px 8px", width: 120 }}>
                    <option value="">Select…</option>
                    {data.holdings.map((h) => <option key={h.id} value={h.id}>{h.id}</option>)}
                  </select>
                </label>
                <Field label="Quantity" value={buyQty} onChange={setBuyQty} width={90} />
                <Field label="Price paid" value={buyPrice} onChange={setBuyPrice} width={90} prefix="$" />
                <Button variant="orange" onClick={recordPurchase}>Record purchase</Button>
              </div>
            </div>

            <SectionTitle>Holdings</SectionTitle>
            <div style={{ overflowX: "auto", marginBottom: 28 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: COLORS.textSecondary, textAlign: "right" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Ticker</th>
                    <th style={{ padding: "6px 8px" }}>Shares</th>
                    <th style={{ padding: "6px 8px" }}>Avg cost</th>
                    <th style={{ padding: "6px 8px" }}>Price</th>
                    <th style={{ padding: "6px 8px" }}>Cost basis</th>
                    <th style={{ padding: "6px 8px" }}>Market value</th>
                    <th style={{ padding: "6px 8px" }}>Yield on cost</th>
                    <th style={{ padding: "6px 8px" }}>Total return</th>
                    <th style={{ padding: "6px 8px" }}>Est. $/mo</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: `0.5px solid ${COLORS.border}` }}>
                      <td style={{ padding: "8px", fontFamily: "monospace", color: COLORS.orange }}>{r.id}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}><EditableCell value={r.shares} onChange={(v) => updateHolding(r.id, "shares", v)} width={85} /></td>
                      <td style={{ padding: "8px", textAlign: "right" }}><EditableCell value={r.avgCost} onChange={(v) => updateHolding(r.id, "avgCost", v)} /></td>
                      <td style={{ padding: "8px", textAlign: "right" }}><EditableCell value={r.price} onChange={(v) => updateHolding(r.id, "price", v)} /></td>
                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace" }}>${fmt(r.costBasis, 0)}</td>
                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace" }}>${fmt(r.marketValue, 0)}</td>
                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: COLORS.green }}>{r.yieldOnCost !== null ? `${fmt(r.yieldOnCost)}%` : "n/a"}</td>
                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: r.totalReturnPct >= 0 ? COLORS.green : COLORS.red }}>{r.totalReturnPct !== null ? `${r.totalReturn >= 0 ? "+" : "-"}$${fmt(Math.abs(r.totalReturn), 0)} (${fmt(r.totalReturnPct, 1)}%)` : "n/a"}</td>
                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: COLORS.orange }}>${fmt(r.monthlyIncome)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <SectionTitle>Dry Powder</SectionTitle>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px", flex: "1 1 160px" }}>
                <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 8, textTransform: "uppercase" }}>Planned DCA</div>
                <input type="number" value={data.monthlyDCA} onChange={(e) => save({ ...data, monthlyDCA: parseFloat(e.target.value) || 0 })}
                  style={{ width: "100%", background: "transparent", border: "none", color: COLORS.textPrimary, fontFamily: "monospace", fontSize: 22, padding: 0 }} />
              </div>
              <Card label="Upcoming dividend cash (auto, 60d)" value={`$${fmt(computed.upcomingDivCash)}`} accent={COLORS.green} />
              <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px", flex: "1 1 160px" }}>
                <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 8, textTransform: "uppercase" }}>Extra cash</div>
                <input type="number" value={data.extraCash} onChange={(e) => save({ ...data, extraCash: parseFloat(e.target.value) || 0 })}
                  style={{ width: "100%", background: "transparent", border: "none", color: COLORS.textPrimary, fontFamily: "monospace", fontSize: 22, padding: 0 }} />
              </div>
              <Card label="Total available" value={`$${fmt(computed.dryPowder)}`} accent={COLORS.orange} />
            </div>
          </>
        )}

        {tab === "watchlist" && (
          <>
            <h1 style={{ ...H, fontSize: 34, margin: "0 0 20px" }}>WATCHLIST</h1>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 20 }}>Price history now builds automatically from real check-ins.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(280px, 1fr))", gap: 16, marginBottom: 20 }}>
              {data.watchlist.map((w) => (
                <div key={w.id} style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontFamily: "monospace", color: COLORS.orange, fontWeight: 600 }}>{w.id}</div>
                      <TextCell value={w.name} onChange={(v) => updateWatch(w.id, "name", v)} width={160} />
                    </div>
                    <div>${fmt(w.price)}</div>
                  </div>
                  <div style={{ height: 100 }}>
                    {(w.priceHistory || []).length >= 2 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={w.priceHistory}>
                          <XAxis dataKey="date" tick={{ fill: COLORS.textMuted, fontSize: 9 }} hide />
                          <YAxis tick={{ fill: COLORS.textMuted, fontSize: 9 }} domain={["auto", "auto"]} />
                          <Tooltip contentStyle={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, fontSize: 11 }} />
                          <Line type="monotone" dataKey="close" stroke={COLORS.orange} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : <div style={{ fontSize: 11, color: COLORS.textMuted, textAlign: "center", paddingTop: 40 }}>Builds after first check-in</div>}
                  </div>
                  <Button variant="ghost" onClick={() => removeWatch(w.id)}>remove</Button>
                </div>
              ))}
            </div>
            <Button variant="orange" onClick={addWatch}>Add ticker</Button>
          </>
        )}

        {tab === "calendar" && (
          <>
            <h1 style={{ ...H, fontSize: 34, margin: "0 0 20px" }}>DIVIDEND CALENDAR</h1>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ color: COLORS.textSecondary, textAlign: "left" }}><th style={{ padding: "6px 8px" }}>Ticker</th><th>Ex-date</th><th>Pay date</th><th style={{ textAlign: "right" }}>Per share</th><th></th><th></th></tr></thead>
              <tbody>
                {upcomingCalendar.map((d, i) => {
                  const h = data.holdings.find((x) => x.id === d.id);
                  const cash = h ? h.shares * d.perShare : 0;
                  return (
                    <tr key={i} style={{ borderTop: `0.5px solid ${COLORS.border}` }}>
                      <td style={{ padding: "8px", fontFamily: "monospace", color: COLORS.orange }}>{d.id}</td>
                      <td style={{ padding: "8px" }}>{d.exDate}</td>
                      <td style={{ padding: "8px" }}>{d.payDate}</td>
                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace" }}>${fmt(d.perShare, 4)} (${fmt(cash)})</td>
                      <td style={{ padding: "8px" }}>{d.estimated && <FlagBadge level="amber" text="est." />}</td>
                      <td style={{ padding: "8px" }}><Button variant="ghost" onClick={() => markReceived(d)}>mark received</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {tab === "journal" && (
          <>
            <h1 style={{ ...H, fontSize: 34, margin: "0 0 20px" }}>DECISION JOURNAL</h1>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input type="text" value={newAlert} onChange={(e) => setNewAlert(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addAlert()}
                placeholder="Log a decision" style={{ flex: 1, background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.textPrimary, fontSize: 13, padding: "8px 12px" }} />
              <Button variant="orange" onClick={addAlert}>Add</Button>
            </div>
            {(data.alertLog || []).map((a, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: `0.5px solid ${COLORS.border}`, fontSize: 13 }}>
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
