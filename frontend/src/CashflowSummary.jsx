import React, { useMemo, useState, useEffect } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";
import { COLORS, H, CURRENCIES, fmt, money, monthLabel, localDateISO } from "./cashflowShared.js";
import { buildMonthly, averageExtra, DEFAULT_CF_SETTINGS } from "./cashflowSummary.js";

const inp = { background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontSize: 14, padding: "7px 9px" };
const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: COLORS.textSecondary };
const th = { padding: "6px 8px", textAlign: "right", fontWeight: 600 };
const td = { padding: "8px", textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap" };

const colour = (v) => (v > 0 ? COLORS.green : v < 0 ? COLORS.red : COLORS.textSecondary);

export default function CashflowSummary({ entries, history, cur, personOk, settings, categories, onSaveSettings }) {
  const s = useMemo(() => ({ ...DEFAULT_CF_SETTINGS, ...(settings || {}) }), [settings]);
  const today = localDateISO();
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const calc = useMemo(
    () => buildMonthly({ entries, history, cur, personOk, settings: s, today }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, history, cur, s, today, personOk]
  );
  const { rows } = calc;

  // Draft of the "cash at start" box so typing doesn't save on every key.
  const [draft, setDraft] = useState({ month: "", amount: "", currency: "SGD" });
  useEffect(() => {
    setDraft({
      month: s.openingMonth || calc.startMonth || today.slice(0, 7),
      amount: s.openingBalance ? String(s.openingBalance) : "",
      currency: s.openingCurrency || "SGD",
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.openingMonth, s.openingBalance, s.openingCurrency, calc.startMonth]);

  const save = async (patch) => {
    setErr(""); setBusy(true);
    try { await onSaveSettings(patch); } catch (e) { setErr("Not saved: " + e.message); }
    setBusy(false);
  };
  const saveOpening = () => {
    const raw = String(draft.amount).trim().replace(",", ".");
    const n = raw === "" ? 0 : parseFloat(raw);
    if (!isFinite(n)) return setErr("Enter the cash amount as a number, or leave it empty for 0.");
    if (!/^\d{4}-\d{2}$/.test(draft.month)) return setErr("Pick the month the running total should start from.");
    save({ openingMonth: draft.month, openingBalance: n, openingCurrency: draft.currency });
  };
  const toggleInvest = (c) => {
    const has = s.investCategories.some((x) => x.toLowerCase() === c.toLowerCase());
    save({ investCategories: has ? s.investCategories.filter((x) => x.toLowerCase() !== c.toLowerCase()) : [...s.investCategories, c] });
  };
  const openingDirty = draft.month !== (s.openingMonth || calc.startMonth || "") || (parseFloat(draft.amount) || 0) !== (s.openingBalance || 0) || draft.currency !== s.openingCurrency;

  if (rows.length === 0) return null;

  const avg = averageExtra(rows);
  const latest = rows[rows.length - 1];
  const shown = (showAll ? rows : rows.slice(-24)).slice().reverse(); // newest first
  const chartRows = rows.slice(-24).map((r) => ({ ...r, label: monthLabel(r.key, false) + (r.key.endsWith("-01") ? ` '${r.key.slice(2, 4)}` : "") }));
  const hasInvest = s.investCategories.length > 0;
  const outCats = categories && categories.out ? categories.out : [];
  // Ticked names that are no longer in the choices still apply to old records, so keep them visible.
  const chipCats = [...outCats, ...s.investCategories.filter((c) => !outCats.some((o) => o.toLowerCase() === c.toLowerCase()))];

  return (
    <>
      <div style={{ marginBottom: 12, marginTop: 30 }}>
        <h2 style={{ ...H, fontWeight: 400, fontSize: 22, margin: 0, textTransform: "uppercase" }}>Monthly summary</h2>
        <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>
          What was left over each month ({cur}), and the running total. Extra cash = money in − spending − investing. A negative month means you spent more than came in.
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px", flex: "1 1 200px" }}>
          <div style={{ fontSize: 13, color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Extra cash so far</div>
          <div style={{ fontFamily: "monospace", fontSize: 22, color: colour(latest.cumulative) }}>{money(latest.cumulative, cur)}</div>
          <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 4 }}>Running total up to {monthLabel(latest.key)}{calc.opening ? `, including ${money(calc.opening, cur)} cash at the start` : ""}</div>
        </div>
        <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px", flex: "1 1 200px" }}>
          <div style={{ fontSize: 13, color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Average extra per month</div>
          <div style={{ fontFamily: "monospace", fontSize: 22, color: avg ? colour(avg.avg) : COLORS.textMuted }}>{avg ? money(avg.avg, cur) : "-"}</div>
          <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 4 }}>{avg ? `Over ${avg.months} finished month${avg.months > 1 ? "s" : ""}; the current month is left out` : "Needs one finished month with records"}</div>
        </div>
      </div>

      <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 8px 8px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartRows} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: COLORS.textSecondary, fontSize: 12 }} stroke={COLORS.border} />
            <YAxis tick={{ fill: COLORS.textSecondary, fontSize: 12 }} stroke={COLORS.border} tickFormatter={(v) => fmt(v, 0)} width={64} />
            <Tooltip formatter={(v, n) => [money(v, cur), n]} contentStyle={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 8 }} labelStyle={{ color: COLORS.textPrimary }} itemStyle={{ color: COLORS.textPrimary }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Legend wrapperStyle={{ fontSize: 13, color: COLORS.textSecondary }} />
            <Bar dataKey="extra" name="Extra cash that month" fill={COLORS.green} maxBarSize={30} radius={[3, 3, 0, 0]}>
              {chartRows.map((r) => <Cell key={r.key} fill={r.extra >= 0 ? COLORS.green : COLORS.red} />)}
            </Bar>
            <Line dataKey="cumulative" name="Running total" stroke={COLORS.amber} strokeWidth={2} dot={{ r: 3, fill: COLORS.amber }} type="monotone" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 760 }}>
          <thead>
            <tr style={{ color: COLORS.textSecondary }}>
              <th style={{ ...th, textAlign: "left" }}>Month</th>
              <th style={th}>Money in</th>
              <th style={th}>Spent</th>
              <th style={th}>Invested</th>
              <th style={th}>Extra cash</th>
              <th style={th}>Kept</th>
              <th style={th}>Running total</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} style={{ borderTop: `0.5px solid ${COLORS.border}`, background: r.extra < 0 ? COLORS.redSoft : "transparent" }}>
                <td style={{ ...td, textAlign: "left", fontFamily: "inherit" }}>
                  {r.label}{r.partial && <span style={{ fontSize: 12, color: COLORS.textMuted }}> · so far</span>}
                  {r.count === 0 && !r.partial && <span style={{ fontSize: 12, color: COLORS.textMuted }}> · no records</span>}
                </td>
                <td style={{ ...td, color: COLORS.green }}>{money(r.income, cur)}</td>
                <td style={{ ...td, color: COLORS.orange }}>{money(r.spent, cur)}</td>
                <td style={{ ...td, color: hasInvest ? COLORS.blue : COLORS.textMuted }}>{hasInvest ? money(r.invested, cur) : "-"}</td>
                <td style={{ ...td, color: colour(r.extra), fontWeight: 600 }}>{money(r.extra, cur)}</td>
                <td style={{ ...td, color: r.kept === null ? COLORS.textMuted : colour(r.kept) }}>{r.kept === null ? "-" : `${fmt(r.kept, 0)}%`}</td>
                <td style={{ ...td, color: colour(r.cumulative) }}>{money(r.cumulative, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!showAll && rows.length > 24 && <div style={{ marginTop: 10 }}><button type="button" onClick={() => setShowAll(true)} style={{ background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 8, padding: "4px 8px", fontSize: 13, cursor: "pointer" }}>Show all {rows.length} months</button></div>}
      <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 8 }}>
        Kept = the share of money in that was not spent (investing counts as kept). Currency exchanges are not counted.
        {calc.unconverted > 0 ? ` ${calc.unconverted} record${calc.unconverted > 1 ? "s have" : " has"} no exchange rate yet and ${calc.unconverted > 1 ? "are" : "is"} left out.` : ""}
        {calc.openingMissingRate ? " The starting cash is in the other currency and there is no exchange rate to convert it yet, so it is left out for now." : ""}
      </div>

      {/* Settings */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
        <div style={{ flex: "1 1 340px", background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, color: COLORS.amber, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, fontWeight: 600 }}>Cash on hand at the start</div>
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 10 }}>Optional. The running total begins in this month with this much cash. Leave the amount empty to start from 0. Records dated before this month are not included.</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={lbl}>Start month
              <input type="month" value={draft.month} onChange={(e) => setDraft((d) => ({ ...d, month: e.target.value }))} style={inp} />
            </label>
            <label style={lbl}>Cash on hand
              <input type="text" inputMode="decimal" value={draft.amount} placeholder="0.00" onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value.replace(/[^0-9.,-]/g, "") }))} style={{ ...inp, width: 120, textAlign: "right", fontFamily: "monospace" }} />
            </label>
            <label style={lbl}>Currency
              <select value={draft.currency} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))} style={inp}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <button type="button" onClick={saveOpening} disabled={busy || !openingDirty} style={{ background: COLORS.orange, border: `0.5px solid ${COLORS.orange}`, color: COLORS.sidebar, fontWeight: 600, borderRadius: 8, padding: "8px 16px", fontSize: 14, cursor: busy || !openingDirty ? "default" : "pointer", opacity: busy || !openingDirty ? 0.5 : 1 }}>Save</button>
          </div>
        </div>
        <div style={{ flex: "1 1 340px", background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, color: COLORS.blue, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, fontWeight: 600 }}>Counts as investing</div>
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 10 }}>Tick the spending categories that are really money you invested (like the monthly DCA). They move from Spent to Invested and count as kept. Extra cash stays the same either way.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {chipCats.map((c) => {
              const on = s.investCategories.some((x) => x.toLowerCase() === c.toLowerCase());
              return (
                <button key={c} type="button" disabled={busy} onClick={() => toggleInvest(c)} aria-pressed={on}
                  style={{ borderRadius: 16, padding: "4px 12px", fontSize: 14, cursor: "pointer", background: on ? COLORS.blueSoft : COLORS.surfaceRaised, border: `0.5px solid ${on ? COLORS.blue : COLORS.border}`, color: on ? COLORS.blue : COLORS.textPrimary }}>
                  {on ? "✓ " : ""}{c}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {err && <div style={{ color: COLORS.red, fontSize: 14, marginTop: 8 }}>{err}</div>}
    </>
  );
}
