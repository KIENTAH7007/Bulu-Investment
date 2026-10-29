import React, { useState, useEffect, useMemo, useRef } from "react";
import { COLORS, fmt } from "./cashflowShared.js";
import { DEFAULT_PLANNER, DEFAULT_LOT, lotFor, valuationInfo, rankBanks, buildPresets, planScenario } from "./plannerCalc.js";

// DCA Planner -- sits under the Strategy tab. Everything here is a "what if": it reads prices, shares,
// average cost and dividend per share from the Portfolio tab and never changes a holding.

const sgd = (n, d = 0) => (n < 0 ? "-" : "") + "S$" + fmt(Math.abs(n), d);
const signed = (n, d = 0) => (n >= 0 ? "+" : "-") + fmt(Math.abs(n), d);
const avgFmt = (n) => fmt(n, n < 10 ? 4 : 2);
const LEVEL = {
  green: { bg: COLORS.greenSoft, color: COLORS.green }, amber: { bg: COLORS.amberSoft, color: COLORS.amber },
  red: { bg: COLORS.redSoft, color: COLORS.red }, none: { bg: COLORS.surfaceRaised, color: COLORS.textMuted },
};

function Badge({ level = "none", children }) {
  const s = LEVEL[level] || LEVEL.none;
  return <span style={{ background: s.bg, color: s.color, fontSize: 12, padding: "2px 8px", borderRadius: 10, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>;
}

function NumInput({ value, onChange, width = 80, placeholder, step = "any", min }) {
  return (
    <input type="number" step={step} min={min} placeholder={placeholder} value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      style={{ width, background: COLORS.surfaceRaised, border: `0.5px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textPrimary, fontFamily: "monospace", fontSize: 14, padding: "6px 8px", textAlign: "right", boxSizing: "border-box" }} />
  );
}

function valuationText(v) {
  if (v.kind === "pb") return `P/B ${fmt(v.pb)}x` + (v.median != null ? ` vs ${fmt(v.median)}x median (${signed(v.premiumPct)}%)` : " (no median set)");
  if (v.kind === "ma") return `${signed(v.vsPct, 1)}% vs ${v.period}-day avg`;
  return "-";
}

const th = { padding: "8px 10px", textAlign: "left", color: COLORS.textSecondary, fontWeight: 600, fontSize: 13, borderBottom: `0.5px solid ${COLORS.border}`, verticalAlign: "bottom" };
const td = { padding: "12px 10px", borderBottom: `0.5px solid ${COLORS.border}`, verticalAlign: "top", fontSize: 14 };
const muted = { color: COLORS.textMuted, fontSize: 12 };

export default function DcaPlanner({ holdings, initial, onSave }) {
  const [s, setS] = useState(() => ({
    ...DEFAULT_PLANNER, ...(initial || {}),
    lots: { ...((initial && initial.lots) || {}) },
    custom: { weights: {}, force: {}, ...((initial && initial.custom) || {}) },
  }));
  const [saved, setSaved] = useState(true);
  const [showCustom, setShowCustom] = useState(false);
  const lastSaved = useRef(JSON.stringify(s));

  // Remember the planner settings (budget, lot sizes, ...) -- saved a moment after you stop typing.
  useEffect(() => {
    const json = JSON.stringify(s);
    if (json === lastSaved.current) return;
    setSaved(false);
    const t = setTimeout(() => { lastSaved.current = json; if (onSave) onSave(s); setSaved(true); }, 700);
    return () => clearTimeout(t);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setS((p) => ({ ...p, ...patch }));
  const setLot = (id, v) => setS((p) => ({ ...p, lots: { ...p.lots, [id]: v } }));
  const setCustom = (kind, id, v) => setS((p) => ({ ...p, custom: { ...p.custom, [kind]: { ...p.custom[kind], [id]: v } } }));

  const priced = useMemo(() => holdings.filter((h) => Number(h.price) > 0), [holdings]);
  const banks = useMemo(() => rankBanks(holdings), [holdings]);
  const presets = useMemo(() => buildPresets(holdings), [holdings]);
  const valuation = useMemo(() => Object.fromEntries(holdings.map((h) => [h.id, valuationInfo(h)])), [holdings]);

  const customWeightTotal = priced.reduce((t, h) => t + (Number(s.custom.weights[h.id]) || 0), 0);
  const customActive = priced.some((h) => Number(s.custom.weights[h.id]) > 0 || (s.custom.force[h.id] !== undefined && s.custom.force[h.id] !== ""));

  const rows = useMemo(() => {
    const list = presets.map((p) => ({ ...p, plan: planScenario(holdings, p.weights, s) }));
    if (customActive) {
      list.push({ key: "custom", label: "Custom split", custom: true, plan: planScenario(holdings, s.custom.weights, s, s.custom.force) });
    }
    return list;
  }, [presets, holdings, s, customActive]);

  const effBudget = (Number(s.budget) || 0) + (Number(s.carry) || 0);
  const tol = Number(s.tolerancePct) || 0;

  return (
    <div>
      {/* ---- Controls ---- */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 8 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: COLORS.textSecondary }}>
          Budget this round (S$)
          <NumInput value={s.budget} onChange={(v) => set({ budget: v })} width={110} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: COLORS.textSecondary }}>
          Carry from last round (S$)
          <NumInput value={s.carry} onChange={(v) => set({ carry: v })} width={110} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: COLORS.textSecondary }}>
          Stretch tolerance (±%)
          <NumInput value={s.tolerancePct} onChange={(v) => set({ tolerancePct: v })} width={90} min={0} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.textSecondary, paddingBottom: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={!!s.includeFees} onChange={(e) => set({ includeFees: e.target.checked })} />
          Include estimated fees
        </label>
        <div style={{ fontSize: 13, color: COLORS.textMuted, paddingBottom: 8 }}>
          To deploy: <span style={{ color: COLORS.textPrimary, fontFamily: "monospace" }}>{sgd(effBudget)}</span>
          {!saved && <span style={{ color: COLORS.amber, marginLeft: 10 }}>saving…</span>}
        </div>
      </div>
      <div style={{ ...muted, lineHeight: 1.6, marginBottom: 20 }}>
        Each leg gets its share of the budget. It buys whole lots, and <b>stretches up one lot if that lot costs no more than the target + {tol}%</b>.
        Set tolerance to 0 to turn the stretch off. A negative "left over" means you went over budget — type it into "Carry" next round.
      </div>

      {/* ---- Holdings: lot size + valuation ---- */}
      <div style={{ overflowX: "auto", marginBottom: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={th}>Ticker</th>
              <th style={{ ...th, textAlign: "right" }}>Price</th>
              <th style={{ ...th, textAlign: "right" }}>Div / share / yr</th>
              <th style={{ ...th, textAlign: "right" }}>Yield</th>
              <th style={{ ...th, textAlign: "right" }}>Lot size</th>
              <th style={th}>Valuation</th>
              <th style={th}>Buy criteria today</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const v = valuation[h.id] || { level: "none", kind: "none" };
              const ok = Number(h.price) > 0;
              const st = h.alertState || {};
              const hasCrit = h.criteria && h.criteria.type;
              return (
                <tr key={h.uid || h.id}>
                  <td style={{ ...td, fontFamily: "monospace", color: COLORS.orange, fontWeight: 600 }}>{h.id}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{ok ? fmt(h.price, h.price < 10 ? 3 : 2) : <span style={muted}>set price</span>}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{Number(h.annualDiv) > 0 ? fmt(h.annualDiv, 4) : <span style={muted}>set dividend</span>}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{ok && Number(h.annualDiv) > 0 ? `${fmt(h.annualDiv / h.price * 100)}%` : "-"}</td>
                  <td style={{ ...td, textAlign: "right" }}><NumInput value={s.lots[h.id] ?? ""} placeholder={String(DEFAULT_LOT)} onChange={(v2) => setLot(h.id, v2)} width={70} step="1" min={1} /></td>
                  <td style={td}>{v.kind === "none" ? <span style={muted}>-</span> : <><Badge level={v.level}>{v.label}</Badge><div style={{ ...muted, marginTop: 3 }}>{valuationText(v)}</div></>}</td>
                  <td style={td}>
                    {hasCrit ? (
                      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                        <Badge level={st.tier1 ? "green" : "none"}>{h.criteria.type === "index-dca" ? "DCA" : "Tier 1"}: {st.tier1 ? "MET" : "not met"}</Badge>
                        <Badge level={st.tier2 ? "green" : "none"}>Tier 2: {st.tier2 ? "MET" : "not met"}</Badge>
                      </span>
                    ) : <span style={muted}>none set</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {banks.length > 0 && (
        <div style={{ background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 22, fontSize: 14, lineHeight: 1.6 }}>
          <b style={{ color: COLORS.orange }}>Best-value bank right now: {banks[0].id}</b>
          {" "}(P/B {fmt(banks[0].pb)}x, {signed(banks[0].premiumPct)}% vs its own median)
          {banks.slice(1).map((b) => <span key={b.id} style={{ color: COLORS.textSecondary }}> · then {b.id} ({signed(b.premiumPct)}%)</span>)}
          <div style={muted}>Banks are ranked by P/B ÷ their own median, lowest first — the "best-value bank" row always picks the top one. A bank only ranks if it has a book value and a median set.</div>
        </div>
      )}

      {/* ---- The table ---- */}
      <div style={{ overflowX: "auto", marginBottom: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead>
            <tr>
              <th style={th}>Option</th>
              <th style={th}>Buys</th>
              <th style={{ ...th, textAlign: "right" }}>Invested</th>
              <th style={{ ...th, textAlign: "right" }}>Left over</th>
              <th style={th}>New average cost</th>
              <th style={{ ...th, textAlign: "right" }}>Monthly dividend added</th>
              <th style={{ ...th, textAlign: "right" }}>Yield on new money</th>
              <th style={th}>Valuation check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = r.plan;
              const okLegs = p.legs.filter((l) => l.ok);
              return (
                <tr key={r.key} style={r.suggested ? { background: "rgba(243,111,74,0.07)" } : undefined}>
                  <td style={{ ...td, maxWidth: 190 }}>
                    {r.suggested && <div style={{ marginBottom: 4 }}><Badge level="green">★ Suggested</Badge></div>}
                    {r.label}
                  </td>
                  <td style={td}>
                    {p.legs.length === 0 && <span style={muted}>nothing selected</span>}
                    {p.legs.map((l) => (
                      <div key={l.id} style={{ marginBottom: 6 }}>
                        {l.ok ? (
                          <>
                            <span style={{ fontFamily: "monospace" }}><b>{fmt(l.shares, 0)}</b> {l.id}</span>
                            <span style={{ ...muted, marginLeft: 6 }}>{sgd(l.cost)}</span>
                            {l.stretched && <span style={{ marginLeft: 6 }}><Badge level="amber">↑ stretched +{fmt(l.devPct, l.devPct < 1 ? 1 : 0)}%</Badge></span>}
                            {l.forced && <span style={{ marginLeft: 6 }}><Badge>your qty</Badge></span>}
                            {l.outside && (
                              <div style={{ ...muted, color: COLORS.amber }}>
                                {signed(l.devPct)}% vs {sgd(l.target)} target{l.alt ? <> · or {fmt(l.alt.shares, 0)} = {sgd(l.alt.cost)} ({signed(l.alt.devPct)}%)</> : null}
                              </div>
                            )}
                            {l.cantAffordLot && <div style={{ ...muted, color: COLORS.amber }}>1 lot = {sgd(l.lotCost)}, over the {sgd(l.target)} target — nothing bought</div>}
                          </>
                        ) : <span style={muted}>{l.id}: {l.reason}</span>}
                      </div>
                    ))}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{sgd(p.invested)}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace", color: p.leftover < 0 ? COLORS.red : COLORS.textPrimary }}>
                    {sgd(p.leftover)}
                    {p.leftover < 0 && <div style={{ ...muted, color: COLORS.red }}>over budget</div>}
                    {s.includeFees && p.fees > 0 && <div style={muted}>incl. ~{sgd(p.fees, 2)} fees</div>}
                  </td>
                  <td style={td}>
                    {okLegs.filter((l) => l.shares > 0).map((l) => (
                      <div key={l.id} style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>
                        <span style={{ color: COLORS.textSecondary }}>{l.id}</span> {avgFmt(l.oldAvg)} → <b>{avgFmt(l.newAvg)}</b>
                      </div>
                    ))}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>
                    <span style={{ color: COLORS.green }}>+S${fmt(p.addedMonthly, 2)}</span>
                    <div style={muted}>portfolio {sgd(p.incomeBefore)} → {sgd(p.incomeAfter)}</div>
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{p.yieldOnNew != null ? `${fmt(p.yieldOnNew)}%` : "-"}</td>
                  <td style={td}>
                    {okLegs.filter((l) => l.shares > 0).map((l) => {
                      const v = valuation[l.id] || { kind: "none", level: "none" };
                      return v.kind === "none" ? null : (
                        <div key={l.id} style={{ marginBottom: 6 }}>
                          <span style={{ fontFamily: "monospace", color: COLORS.textSecondary, marginRight: 6 }}>{l.id}</span>
                          <Badge level={v.level}>{v.kind === "pb" && v.premiumPct != null ? `${signed(v.premiumPct)}% vs median` : v.kind === "ma" ? `${signed(v.vsPct, 1)}% vs ${v.period}d avg` : v.label}</Badge>
                        </div>
                      );
                    })}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} style={{ ...td, color: COLORS.textMuted, fontStyle: "italic" }}>Add G3B / U11 / D05 (with a price) in the Portfolio tab, or build a custom split below.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---- Custom split ---- */}
      <div style={{ marginBottom: 14 }}>
        <button onClick={() => setShowCustom((x) => !x)} style={{ background: "none", border: "none", color: COLORS.orange, cursor: "pointer", fontSize: 14, padding: 0 }}>
          {showCustom ? "▾" : "▸"} Custom split{customActive ? " (in the table above)" : ""}
        </button>
        {showCustom && (
          <div style={{ marginTop: 10, background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ ...muted, marginBottom: 10, lineHeight: 1.6 }}>
              Type a % for each stock you want in the split. If you want an exact quantity instead (say, 20 D05 even though it stretches past the tolerance),
              type it under "Your qty" — that overrides the lot rule for that stock. Any stock in the Portfolio tab shows up here, including ones you add later.
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              {priced.map((h) => (
                <div key={h.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontFamily: "monospace", color: COLORS.orange, fontWeight: 600 }}>{h.id}</span>
                  <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "flex", flexDirection: "column", gap: 3 }}>
                    % of budget
                    <NumInput value={s.custom.weights[h.id] ?? ""} onChange={(v) => setCustom("weights", h.id, v)} width={90} />
                  </label>
                  <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "flex", flexDirection: "column", gap: 3 }}>
                    Your qty (optional)
                    <NumInput value={s.custom.force[h.id] ?? ""} onChange={(v) => setCustom("force", h.id, v)} width={90} step="1" min={0} />
                  </label>
                </div>
              ))}
            </div>
            <div style={{ ...muted, marginTop: 10 }}>
              Total: {fmt(customWeightTotal, 0)}% {customWeightTotal > 100 && <span style={{ color: COLORS.amber }}>— over 100%, you'd be overspending the budget</span>}
              <button onClick={() => set({ custom: { weights: {}, force: {} } })} style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", marginLeft: 12, fontSize: 12 }}>clear custom</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ ...muted, lineHeight: 1.7 }}>
        Prices, share counts, average costs and dividend per share all come from the Portfolio tab, so keep those current. New average cost uses price only
        (the same way "Record a purchase" works), and nothing here changes your holdings — once you actually buy, record it in the Portfolio tab.
        Fees are a rough estimate for Moomoo SG on SGX (platform fee 0.03%, min S$0.99, plus SGX fees and GST; commission waived in the current promotion) — the order preview is the real number.
        "Monthly dividend added" is the yearly dividend per share ÷ 12, before any tax. This is a planning aid, not advice.
      </div>
    </div>
  );
}
