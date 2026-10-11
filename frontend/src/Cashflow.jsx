import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";
import {
  COLORS, H, PEOPLE, CURRENCIES, TYPE_LABEL, TYPE_COLOR, fmt, money, localDateISO, newClientId,
  monthLabel, shiftMonth, monthsBetween, convert, buildCsv,
} from "./cashflowShared.js";

const inp = { background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontSize: 14, padding: "7px 9px" };
const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: COLORS.textSecondary };

function Btn({ children, onClick, variant = "default", disabled, type = "button", small }) {
  const v = {
    default: { background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, color: COLORS.textPrimary },
    orange: { background: COLORS.orange, border: `0.5px solid ${COLORS.orange}`, color: COLORS.sidebar, fontWeight: 600 },
    ghost: { background: "none", border: "none", color: COLORS.textMuted },
  }[variant];
  return <button type={type} onClick={onClick} disabled={disabled} style={{ ...v, borderRadius: 8, padding: small ? "4px 8px" : "8px 16px", fontSize: small ? 13 : 14, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>{children}</button>;
}
function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px", flex: "1 1 170px", minWidth: 160 }}>
      <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 500, color: accent || COLORS.textPrimary }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
function Section({ children, sub }) {
  return (
    <div style={{ marginBottom: 12, marginTop: 30 }}>
      <h2 style={{ ...H, fontWeight: 400, fontSize: 22, margin: 0, textTransform: "uppercase" }}>{children}</h2>
      {sub && <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Pills({ options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", border: `0.5px solid ${COLORS.border}`, borderRadius: 8, overflow: "hidden" }}>
      {options.map(([v, t]) => (
        <button key={v} type="button" onClick={() => onChange(v)} style={{ padding: "7px 14px", fontSize: 14, cursor: "pointer", border: "none", background: value === v ? COLORS.orange : COLORS.surface, color: value === v ? COLORS.sidebar : COLORS.textSecondary, fontWeight: value === v ? 600 : 400 }}>{t}</button>
      ))}
    </div>
  );
}

const blankForm = () => ({ type: "out", amount: "", currency: "MYR", date: localDateISO(), who: "KT", category: "", note: "" });

export default function Cashflow({ fx }) {
  const history = useMemo(() => (fx && Array.isArray(fx.history) ? fx.history : []), [fx]);
  const [cf, setCf] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [mode, setMode] = useState("month");
  const [month, setMonth] = useState(localDateISO().slice(0, 7));
  const [year, setYear] = useState(localDateISO().slice(0, 4));
  const [cur, setCur] = useState("SGD");
  const [person, setPerson] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("all");
  const [breakdown, setBreakdown] = useState("out");
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState(blankForm());
  const [editingId, setEditingId] = useState(null);
  const [formErr, setFormErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState({ in: "", out: "" });
  const [catErr, setCatErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/cashflow");
      if (!r.ok) throw new Error("HTTP " + r.status);
      setCf(await r.json());
      setLoadErr("");
    } catch (e) {
      setLoadErr(`Could not refresh the ledger (${e.message}). Showing the last data loaded.`);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000); // picks up entries made from phones
    return () => clearInterval(t);
  }, [load]);

  const entries = cf ? cf.entries : [];
  const categories = cf ? cf.categories : { in: [], out: [] };

  const inPeriod = useCallback((date) => (mode === "all" ? true : mode === "year" ? date.startsWith(year) : date.startsWith(month)), [mode, month, year]);
  const personOk = (e) => person === "ALL" || e.who === person;

  // Sum entries of one type in a date test, in the display currency. Entries with no usable rate are counted, not guessed.
  const sumBy = useCallback((test) => {
    const out = { in: 0, out: 0, unconverted: 0, transfers: 0, transferSGD: 0, native: { in: { SGD: 0, MYR: 0 }, out: { SGD: 0, MYR: 0 } } };
    for (const e of entries) {
      if (!personOk(e) || !test(e.date)) continue;
      if (e.type === "transfer") { out.transfers++; const v = convert(e, "SGD", history); if (v !== null) out.transferSGD += v; continue; }
      out.native[e.type][e.currency] += e.amount;
      const v = convert(e, cur, history);
      if (v === null) out.unconverted++; else out[e.type] += v;
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, history, cur, person]);

  const totals = useMemo(() => sumBy(inPeriod), [sumBy, inPeriod]);
  const prev = useMemo(() => {
    if (mode === "month") { const pk = shiftMonth(month, -1); return { key: pk, t: sumBy((d) => d.startsWith(pk)) }; }
    if (mode === "year") { const py = String(Number(year) - 1); return { key: py, t: sumBy((d) => d.startsWith(py)) }; }
    return null;
  }, [mode, month, year, sumBy]);

  const net = totals.in - totals.out;
  const savingsRate = totals.in > 0 ? (net / totals.in) * 100 : null;
  const vsPrev = (now, before) => (before > 0 ? `${now >= before ? "▲" : "▼"} ${fmt(Math.abs((now / before - 1) * 100), 0)}% vs ${monthLabelOrYear(prev.key)}` : null);
  const monthLabelOrYear = (k) => (k.length === 7 ? monthLabel(k) : k);

  // Monthly trend series
  const series = useMemo(() => {
    let keys;
    if (mode === "month") keys = monthsBetween(shiftMonth(month, -11), month);
    else if (mode === "year") keys = monthsBetween(`${year}-01`, `${year}-12`);
    else {
      const ms = entries.map((e) => e.date.slice(0, 7)).sort();
      const last = localDateISO().slice(0, 7);
      const first = ms.length ? ms[0] : last;
      const from = first < shiftMonth(last, -35) ? shiftMonth(last, -35) : first;
      keys = monthsBetween(from, ms.length && ms[ms.length - 1] > last ? ms[ms.length - 1] : last);
    }
    const rows = keys.map((k) => ({ key: k, label: monthLabel(k, false) + (k.endsWith("-01") || k === keys[0] ? ` '${k.slice(2, 4)}` : ""), income: 0, spending: 0 }));
    const idx = new Map(rows.map((r, i) => [r.key, i]));
    for (const e of entries) {
      if (e.type === "transfer" || !personOk(e)) continue;
      const i = idx.get(e.date.slice(0, 7));
      if (i === undefined) continue;
      const v = convert(e, cur, history);
      if (v === null) continue;
      if (e.type === "in") rows[i].income += v; else rows[i].spending += v;
    }
    return rows.map((r) => ({ ...r, income: Math.round(r.income * 100) / 100, spending: Math.round(r.spending * 100) / 100, net: Math.round((r.income - r.spending) * 100) / 100 }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, history, cur, person, mode, month, year]);

  // Category breakdown for the chosen period
  const byCategory = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      if (e.type !== breakdown || !personOk(e) || !inPeriod(e.date)) continue;
      const v = convert(e, cur, history);
      if (v === null) continue;
      m.set(e.category, (m.get(e.category) || 0) + v);
    }
    return [...m.entries()].map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, history, cur, person, breakdown, inPeriod]);

  const listRows = useMemo(() => entries
    .filter((e) => personOk(e) && inPeriod(e.date) && (typeFilter === "all" || e.type === typeFilter))
    .sort((a, b) => (a.date === b.date ? (b.createdAt || "").localeCompare(a.createdAt || "") : b.date.localeCompare(a.date))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [entries, person, inPeriod, typeFilter]);
  const shownRows = showAll ? listRows : listRows.slice(0, 100);

  // ----- add / edit / delete -----
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v, ...(k === "type" ? { category: v === "transfer" ? "Exchange" : "" } : {}) }));
  const startEdit = (e) => {
    setEditingId(e.id);
    setForm({ type: e.type, amount: String(e.amount), currency: e.currency, date: e.date, who: e.who, category: e.category, note: e.note || "" });
    setFormErr("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancelEdit = () => { setEditingId(null); setForm(blankForm()); setFormErr(""); };
  const submitForm = async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const amt = parseFloat(String(form.amount).replace(",", "."));
    if (!isFinite(amt) || amt <= 0) return setFormErr("Enter an amount.");
    if (!form.category) return setFormErr("Choose a category.");
    setBusy(true); setFormErr("");
    try {
      const body = { ...form, amount: amt };
      const r = editingId
        ? await fetch(`/api/cashflow/entries/${editingId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/cashflow/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, clientId: newClientId() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
      await load();
      if (editingId) cancelEdit(); else setForm((f) => ({ ...blankForm(), type: f.type, currency: f.currency, who: f.who }));
    } catch (e) { setFormErr("Not saved: " + e.message); }
    setBusy(false);
  };
  const del = async (e) => {
    if (!window.confirm(`Delete this ${TYPE_LABEL[e.type].toLowerCase()} entry?\n${e.date} · ${e.category} · ${money(e.amount, e.currency)}${e.note ? " · " + e.note : ""}`)) return;
    try {
      const r = await fetch(`/api/cashflow/entries/${e.id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) throw new Error("HTTP " + r.status);
      if (editingId === e.id) cancelEdit();
      await load();
    } catch (er) { setLoadErr("Delete failed: " + er.message); }
  };

  // ----- categories -----
  const saveCats = async (next) => {
    setCatErr("");
    try {
      const r = await fetch("/api/cashflow/categories", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
      setCf((c) => ({ ...c, categories: d.categories }));
    } catch (e) { setCatErr(e.message); }
  };
  const addCat = (t) => {
    const name = newCat[t].trim();
    if (!name) return;
    if (categories[t].some((c) => c.toLowerCase() === name.toLowerCase())) return setCatErr(`"${name}" already exists.`);
    saveCats({ ...categories, [t]: [...categories[t], name] });
    setNewCat((n) => ({ ...n, [t]: "" }));
  };
  const removeCat = (t, name) => {
    if (categories[t].length <= 1) return setCatErr("Keep at least one category.");
    if (!window.confirm(`Remove "${name}" from the ${t === "in" ? "Income" : "Spending"} list?\nExisting records keep this category name; it just stops appearing in the choices.`)) return;
    saveCats({ ...categories, [t]: categories[t].filter((c) => c !== name) });
  };

  const exportCsv = () => {
    const blob = new Blob([buildCsv([...entries].sort((a, b) => a.date.localeCompare(b.date)), history)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cashflow-${localDateISO()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  if (!cf) return <div style={{ color: COLORS.textSecondary }}>{loadErr || "Loading cashflow…"}</div>;

  const periodText = mode === "month" ? monthLabel(month) : mode === "year" ? year : "All time";
  const catChoices = form.type === "transfer" ? [] : [...categories[form.type]];
  if (form.type !== "transfer" && form.category && !catChoices.includes(form.category)) catChoices.push(form.category);
  const needRates = history.length === 0 && (entries.some((e) => e.currency !== cur));
  const tooltipMoney = (v) => money(v, cur);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
        <h1 style={{ ...H, fontSize: 34, margin: 0 }}>CASHFLOW</h1>
        <div style={{ fontSize: 13, color: COLORS.textMuted }}>Phone entry page: <span style={{ fontFamily: "monospace", color: COLORS.textSecondary }}>{window.location.origin}/add</span></div>
      </div>
      <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>
        Every record of money in and out. Totals and charts show one currency at a time ({cur}); MYR/SGD amounts are converted at that day's market rate, and the original amounts are always kept.
      </div>
      {loadErr && <div style={{ background: COLORS.amberSoft, color: COLORS.amber, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>{loadErr}</div>}
      {needRates && <div style={{ background: COLORS.amberSoft, color: COLORS.amber, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>The SGD/MYR rate history has not loaded yet (it arrives with the next check-in), so amounts in the other currency are left out of totals for now.</div>}

      {/* Filters */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
        <Pills options={[["month", "Month"], ["year", "Year"], ["all", "All time"]]} value={mode} onChange={setMode} />
        {mode === "month" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Btn small onClick={() => setMonth(shiftMonth(month, -1))}>◀</Btn>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={inp} aria-label="Month" />
            <Btn small onClick={() => setMonth(shiftMonth(month, 1))}>▶</Btn>
          </span>
        )}
        {mode === "year" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Btn small onClick={() => setYear(String(Number(year) - 1))}>◀</Btn>
            <span style={{ fontFamily: "monospace", fontSize: 16, minWidth: 48, textAlign: "center" }}>{year}</span>
            <Btn small onClick={() => setYear(String(Number(year) + 1))}>▶</Btn>
          </span>
        )}
        <Pills options={[["SGD", "S$ SGD"], ["MYR", "RM MYR"]]} value={cur} onChange={setCur} />
        <Pills options={[["ALL", "Everyone"], ...PEOPLE.map((p) => [p, p])]} value={person} onChange={setPerson} />
      </div>

      {/* Summary */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <StatCard label={`Money in · ${periodText}`} value={money(totals.in, cur)} accent={COLORS.green} sub={prev && vsPrev(totals.in, prev.t.in)} />
        <StatCard label={`Spending · ${periodText}`} value={money(totals.out, cur)} accent={COLORS.orange}
          sub={[totals.native.out.MYR > 0 && `RM${fmt(totals.native.out.MYR, 0)} paid in MYR`, totals.native.out.SGD > 0 && `S$${fmt(totals.native.out.SGD, 0)} paid in SGD`].filter(Boolean).join(" · ") || (prev && vsPrev(totals.out, prev.t.out))} />
        <StatCard label="Net" value={money(net, cur)} accent={net >= 0 ? COLORS.green : COLORS.red} sub="Money in minus spending" />
        <StatCard label="Savings rate" value={savingsRate === null ? "-" : `${fmt(savingsRate, 0)}%`} accent={savingsRate === null ? undefined : savingsRate >= 0 ? COLORS.green : COLORS.red} sub={savingsRate === null ? "No income in this period" : "Net as a share of money in"} />
      </div>
      <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 4 }}>
        {totals.transfers > 0 ? `${totals.transfers} currency exchange${totals.transfers > 1 ? "s" : ""} in this period (about S$${fmt(totals.transferSGD, 0)}) are recorded but not counted as income or spending. ` : ""}
        {totals.unconverted > 0 ? `${totals.unconverted} entr${totals.unconverted > 1 ? "ies have" : "y has"} no exchange rate available and ${totals.unconverted > 1 ? "are" : "is"} left out of these totals.` : ""}
      </div>

      {/* Trend chart */}
      <Section sub={`Income vs spending by month in ${cur}, with the net line.${mode === "month" ? " Shows the 12 months up to the selected month." : mode === "all" ? " Shows up to the last 36 months." : ""}`}>Trend</Section>
      {entries.length === 0 ? (
        <div style={{ color: COLORS.textMuted, fontStyle: "italic", padding: "12px 0" }}>No records yet. Add the first one below, or from the phone entry page.</div>
      ) : (
        <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 8px 8px" }}>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={series} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: COLORS.textSecondary, fontSize: 12 }} stroke={COLORS.border} />
              <YAxis tick={{ fill: COLORS.textSecondary, fontSize: 12 }} stroke={COLORS.border} tickFormatter={(v) => fmt(v, 0)} width={64} />
              <Tooltip formatter={(v, n) => [tooltipMoney(v), n]} contentStyle={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 8 }} labelStyle={{ color: COLORS.textPrimary }} itemStyle={{ color: COLORS.textPrimary }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Legend wrapperStyle={{ fontSize: 13, color: COLORS.textSecondary }} />
              <Bar dataKey="income" name="Money in" fill={COLORS.green} radius={[3, 3, 0, 0]} maxBarSize={26} />
              <Bar dataKey="spending" name="Spending" fill={COLORS.orange} radius={[3, 3, 0, 0]} maxBarSize={26} />
              <Line dataKey="net" name="Net" stroke={COLORS.amber} strokeWidth={2} dot={{ r: 3, fill: COLORS.amber }} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Category breakdown */}
      <Section sub={`Where it ${breakdown === "out" ? "went" : "came from"} in ${periodText}, in ${cur}.`}>Breakdown</Section>
      <div style={{ marginBottom: 10 }}><Pills options={[["out", "Spending"], ["in", "Money in"]]} value={breakdown} onChange={setBreakdown} /></div>
      {byCategory.length === 0 ? (
        <div style={{ color: COLORS.textMuted, fontStyle: "italic", padding: "8px 0" }}>Nothing recorded for this selection.</div>
      ) : (
        <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "12px 8px 4px" }}>
          <ResponsiveContainer width="100%" height={Math.max(120, byCategory.length * 38 + 20)}>
            <BarChart data={byCategory} layout="vertical" margin={{ top: 0, right: 90, left: 4, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={150} tick={{ fill: COLORS.textPrimary, fontSize: 13 }} stroke={COLORS.border} />
              <Tooltip formatter={(v) => [tooltipMoney(v), breakdown === "out" ? "Spent" : "Received"]} contentStyle={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 8 }} labelStyle={{ color: COLORS.textPrimary }} itemStyle={{ color: COLORS.textPrimary }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: "right", fill: COLORS.textSecondary, fontSize: 12, formatter: (v) => money(v, cur, 0) }}>
                {byCategory.map((c) => <Cell key={c.name} fill={breakdown === "out" ? COLORS.orange : COLORS.green} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Add / edit */}
      <Section sub={editingId ? "Editing an existing record -- save to apply, or cancel." : "Add a record here, or use the phone entry page."}>{editingId ? "Edit record" : "Add record"}</Section>
      <form onSubmit={submitForm} style={{ background: COLORS.surface, border: `0.5px solid ${editingId ? COLORS.orange : COLORS.border}`, borderRadius: 10, padding: 16, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={lbl}>Type
          <select value={form.type} onChange={(e) => setF("type", e.target.value)} style={inp}>
            <option value="out">Money out</option><option value="in">Money in</option><option value="transfer">Transfer (exchange)</option>
          </select>
        </label>
        <label style={lbl}>Amount
          <input type="text" inputMode="decimal" value={form.amount} onChange={(e) => setF("amount", e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" style={{ ...inp, width: 110, textAlign: "right", fontFamily: "monospace" }} />
        </label>
        <label style={lbl}>Currency
          <select value={form.currency} onChange={(e) => setF("currency", e.target.value)} style={inp}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label style={lbl}>Date
          <input type="date" value={form.date} onChange={(e) => setF("date", e.target.value)} style={inp} />
        </label>
        <label style={lbl}>Who
          <select value={form.who} onChange={(e) => setF("who", e.target.value)} style={inp}>{PEOPLE.map((p) => <option key={p}>{p}</option>)}</select>
        </label>
        <label style={lbl}>Category
          {form.type === "transfer"
            ? <input type="text" value={form.category} onChange={(e) => setF("category", e.target.value)} style={{ ...inp, width: 120 }} />
            : <select value={form.category} onChange={(e) => setF("category", e.target.value)} style={{ ...inp, minWidth: 150 }}><option value="">Choose…</option>{catChoices.map((c) => <option key={c}>{c}</option>)}</select>}
        </label>
        <label style={{ ...lbl, flex: "1 1 180px" }}>Note (optional)
          <input type="text" maxLength={200} value={form.note} onChange={(e) => setF("note", e.target.value)} style={inp} />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn type="submit" variant="orange" disabled={busy}>{busy ? "Saving…" : editingId ? "Save changes" : "Add"}</Btn>
          {editingId && <Btn onClick={cancelEdit}>Cancel</Btn>}
        </div>
        {formErr && <div style={{ flexBasis: "100%", color: COLORS.red, fontSize: 14 }}>{formErr}</div>}
      </form>

      {/* Records list */}
      <Section sub={`${listRows.length} record${listRows.length === 1 ? "" : "s"} in ${periodText}${person !== "ALL" ? ` for ${person}` : ""}. Newest first.`}>Records</Section>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <Pills options={[["all", "All"], ["in", "In"], ["out", "Out"], ["transfer", "Transfer"]]} value={typeFilter} onChange={setTypeFilter} />
        <Btn small onClick={exportCsv} disabled={entries.length === 0}>Export all as CSV</Btn>
        <Btn small onClick={load}>Refresh</Btn>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 720 }}>
          <thead>
            <tr style={{ color: COLORS.textSecondary, textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>Date</th><th style={{ padding: "6px 8px" }}>Who</th><th style={{ padding: "6px 8px" }}>Type</th><th style={{ padding: "6px 8px" }}>Category</th><th style={{ padding: "6px 8px" }}>Note</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Amount</th><th style={{ padding: "6px 8px", textAlign: "right" }}>≈ {cur}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shownRows.length === 0 && <tr><td colSpan={8} style={{ padding: "14px 8px", color: COLORS.textMuted, fontStyle: "italic" }}>No records for this selection.</td></tr>}
            {shownRows.map((e) => {
              const conv = e.currency === cur ? null : convert(e, cur, history);
              const sign = e.type === "out" ? "−" : e.type === "in" ? "+" : "⇄";
              return (
                <tr key={e.id} style={{ borderTop: `0.5px solid ${COLORS.border}`, background: e.id === editingId ? COLORS.surfaceRaised : "transparent" }}>
                  <td style={{ padding: "8px", whiteSpace: "nowrap" }}>{e.date}<div style={{ fontSize: 11, color: COLORS.textMuted }}>{e.createdAt ? "entered " + new Date(e.createdAt).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" }) : ""}</div></td>
                  <td style={{ padding: "8px" }}>{e.who}</td>
                  <td style={{ padding: "8px", color: TYPE_COLOR[e.type], fontWeight: 600 }}>{TYPE_LABEL[e.type]}</td>
                  <td style={{ padding: "8px" }}>{e.category}</td>
                  <td style={{ padding: "8px", color: COLORS.textSecondary, maxWidth: 260, overflowWrap: "anywhere" }}>{e.note}</td>
                  <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: TYPE_COLOR[e.type], whiteSpace: "nowrap" }}>{sign} {money(e.amount, e.currency)}</td>
                  <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: COLORS.textMuted, whiteSpace: "nowrap" }}>{e.currency === cur ? "" : conv === null ? "no rate" : money(conv, cur)}</td>
                  <td style={{ padding: "8px", whiteSpace: "nowrap" }}><Btn variant="ghost" small onClick={() => startEdit(e)}>edit</Btn><Btn variant="ghost" small onClick={() => del(e)}>delete</Btn></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!showAll && listRows.length > 100 && <div style={{ marginTop: 10 }}><Btn small onClick={() => setShowAll(true)}>Show all {listRows.length} records</Btn></div>}

      {/* Categories */}
      <Section sub="The choices offered when adding a record (here and on the phone page). Removing a category never changes existing records.">Categories</Section>
      {catErr && <div style={{ color: COLORS.red, fontSize: 14, marginBottom: 8 }}>{catErr}</div>}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {[["in", "Money in", COLORS.green], ["out", "Spending", COLORS.orange]].map(([t, title, color]) => (
          <div key={t} style={{ flex: "1 1 320px", background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 13, color, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, fontWeight: 600 }}>{title}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {categories[t].map((c) => (
                <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 16, padding: "4px 6px 4px 12px", fontSize: 14 }}>
                  {c}<button type="button" aria-label={`Remove ${c}`} onClick={() => removeCat(t, c)} style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" maxLength={40} value={newCat[t]} placeholder="New category" onChange={(e) => setNewCat((n) => ({ ...n, [t]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCat(t))} style={{ ...inp, flex: 1 }} />
              <Btn onClick={() => addCat(t)}>Add</Btn>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
