import React, { useState, useEffect, useCallback, useRef } from "react";
import { COLORS, H, PEOPLE, CURRENCIES, TYPE_COLOR, money, localDateISO, newClientId } from "./cashflowShared.js";

// Phone-friendly quick-entry page, served at /add. Adds records only; edits/deletes happen in the main app.
// Entries are written to a small queue on this phone FIRST, then sent. If the signal drops, they wait
// in the queue and are retried automatically -- nothing is lost, and the clientId stops duplicates.

const LS = { pending: "bulu_cf_pending", recent: "bulu_cf_recent", prefs: "bulu_cf_prefs", cats: "bulu_cf_cats" };
const lsGet = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
const DEFAULT_CATS = { in: ["Dividends", "Pawvy", "HDB rental", "Other income"], out: ["Rent", "Food & dining", "Groceries", "Transport & fuel", "Utilities & internet", "Dog", "Health", "Shopping", "Travel", "Other"] };

const inputStyle = { width: "100%", boxSizing: "border-box", background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 12, color: COLORS.textPrimary, fontSize: 18, padding: "14px 14px", minHeight: 52 };
const labelStyle = { fontSize: 13, color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: 0.6, margin: "18px 0 8px" };

function Seg({ options, value, onChange, colorFor, label }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 8 }}>
      {options.map(([val, text]) => {
        const on = value === val;
        const c = colorFor ? colorFor(val) : COLORS.orange;
        return (
          <button key={val} type="button" aria-pressed={on} onClick={() => onChange(val)}
            style={{ flex: 1, minHeight: 52, borderRadius: 12, fontSize: 17, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${on ? c : COLORS.border}`, background: on ? c : COLORS.surface, color: on ? COLORS.sidebar : COLORS.textSecondary }}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

export default function Entry() {
  const prefs0 = lsGet(LS.prefs, {});
  const [type, setType] = useState("out");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(prefs0.currency || "MYR");
  const [who, setWho] = useState(prefs0.who || "");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(localDateISO());
  const [note, setNote] = useState("");
  const [cats, setCats] = useState(lsGet(LS.cats, DEFAULT_CATS));
  const [recent, setRecent] = useState(lsGet(LS.recent, []));
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [formErr, setFormErr] = useState("");
  const flushing = useRef(false);

  useEffect(() => {
    document.title = "Add entry";
    const add = (rel, href, extra = {}) => { const l = document.createElement("link"); l.rel = rel; l.href = href; Object.entries(extra).forEach(([k, v]) => l.setAttribute(k, v)); document.head.appendChild(l); return l; };
    const meta = document.createElement("meta"); meta.name = "theme-color"; meta.content = COLORS.bg; document.head.appendChild(meta);
    const links = [add("manifest", "/add.webmanifest"), add("apple-touch-icon", "/icon-180.png")];
    document.body.style.background = COLORS.bg;
    return () => { links.forEach((l) => l.remove()); meta.remove(); };
  }, []);

  const loadCats = useCallback(async () => {
    try {
      const r = await fetch("/api/cashflow");
      if (!r.ok) return;
      const d = await r.json();
      if (d.categories) { setCats(d.categories); lsSet(LS.cats, d.categories); }
    } catch { /* offline: keep cached categories */ }
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const queue = lsGet(LS.pending, []);
      for (const item of queue) {
        let status = null, error = "";
        try {
          const r = await fetch("/api/cashflow/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
          if (r.ok) status = "saved";
          else if (r.status >= 400 && r.status < 500) { status = "failed"; try { error = (await r.json()).error || ""; } catch { error = "rejected"; } }
          else break; // server trouble: keep it queued, try again later
        } catch { break; } // offline: keep it queued
        const stillPending = lsGet(LS.pending, []).filter((p) => p.clientId !== item.clientId);
        lsSet(LS.pending, stillPending);
        const rec = lsGet(LS.recent, []).map((x) => (x.clientId === item.clientId ? { ...x, status, error } : x));
        lsSet(LS.recent, rec);
        setRecent(rec);
      }
    } finally { flushing.current = false; }
  }, []);

  useEffect(() => {
    loadCats();
    flush();
    const t = setInterval(flush, 15000);
    const onOnline = () => { flush(); loadCats(); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) flush(); });
    return () => { clearInterval(t); window.removeEventListener("online", onOnline); };
  }, [flush, loadCats]);

  const catList = type === "in" ? cats.in : type === "out" ? cats.out : [];
  const pendingCount = recent.filter((r) => r.status === "pending").length;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const amt = parseFloat(String(amount).replace(",", "."));
    if (!isFinite(amt) || amt <= 0) return setFormErr("Enter an amount.");
    if (!who) return setFormErr("Choose who is entering this (KT / J / B).");
    if (type !== "transfer" && !category) return setFormErr("Choose a category.");
    setFormErr("");
    setBusy(true);
    const item = { clientId: newClientId(), type, amount: amt, currency, date: date || localDateISO(), who, category: type === "transfer" ? "Exchange" : category, note: note.trim() };
    lsSet(LS.pending, [...lsGet(LS.pending, []), item]);
    const rec = [{ ...item, status: "pending", error: "", at: Date.now() }, ...lsGet(LS.recent, [])].slice(0, 8);
    lsSet(LS.recent, rec); setRecent(rec);
    lsSet(LS.prefs, { currency, who });
    await flush();
    const after = lsGet(LS.recent, []).find((x) => x.clientId === item.clientId);
    if (after && after.status === "saved") setToast({ ok: true, text: `Saved ✓  ${money(amt, currency)} · ${item.category}` });
    else if (after && after.status === "failed") setToast({ ok: false, text: `Not saved: ${after.error || "rejected"}` });
    else setToast({ ok: true, text: "No signal — saved on this phone, will send automatically" });
    setAmount(""); setNote(""); setCategory(""); setDate(localDateISO());
    setBusy(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => setToast(null), 5000);
  };

  const submitColor = TYPE_COLOR[type];
  const submitText = type === "in" ? "Save income" : type === "out" ? "Save expense" : "Save transfer";

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.textPrimary, fontFamily: "sans-serif", display: "flex", justifyContent: "center" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 480, padding: "20px 16px 60px", boxSizing: "border-box" }}>
        <div style={{ ...H, fontSize: 16, color: COLORS.orange }}>BULU FAMILY</div>
        <div style={{ ...H, fontSize: 32, marginBottom: 4 }}>ADD ENTRY</div>

        {toast && <div role="status" style={{ background: toast.ok ? COLORS.greenSoft : COLORS.redSoft, color: toast.ok ? COLORS.green : COLORS.red, borderRadius: 12, padding: "12px 14px", fontSize: 16, marginTop: 8 }}>{toast.text}</div>}
        {pendingCount > 0 && !toast && <div style={{ background: COLORS.amberSoft, color: COLORS.amber, borderRadius: 12, padding: "10px 14px", fontSize: 14, marginTop: 8 }}>{pendingCount} waiting to send — will retry automatically</div>}

        <div style={labelStyle}>Type</div>
        <Seg label="Type" options={[["out", "Money out"], ["in", "Money in"], ["transfer", "Transfer"]]} value={type} onChange={(v) => { setType(v); setCategory(""); }} colorFor={(v) => TYPE_COLOR[v]} />
        {type === "transfer" && <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 8 }}>For currency exchanges (e.g. SGD → MYR). Recorded, but not counted as income or spending.</div>}

        <div style={labelStyle}>Amount</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input aria-label="Amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
            style={{ ...inputStyle, fontSize: 28, fontFamily: "monospace", flex: 1, minWidth: 0 }} />
          <div style={{ width: 150, flexShrink: 0 }}>
            <Seg label="Currency" options={CURRENCIES.map((c) => [c, c])} value={currency} onChange={setCurrency} />
          </div>
        </div>

        {type !== "transfer" && (
          <>
            <div style={labelStyle}>Category</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {catList.map((c) => {
                const on = category === c;
                return (
                  <button key={c} type="button" aria-pressed={on} onClick={() => setCategory(c)}
                    style={{ minHeight: 46, padding: "0 16px", borderRadius: 24, fontSize: 16, cursor: "pointer", border: `1.5px solid ${on ? submitColor : COLORS.border}`, background: on ? submitColor : COLORS.surface, color: on ? COLORS.sidebar : COLORS.textPrimary, fontWeight: on ? 600 : 400 }}>
                    {c}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div style={labelStyle}>Who</div>
        <Seg label="Who" options={PEOPLE.map((p) => [p, p])} value={who} onChange={setWho} />

        <div style={labelStyle}>Date</div>
        <input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />

        <div style={labelStyle}>Note (optional)</div>
        <input aria-label="Note" type="text" maxLength={200} placeholder={type === "transfer" ? "e.g. SGD → MYR via Wise" : "e.g. dinner at Kempas"} value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />

        {formErr && <div role="alert" style={{ color: COLORS.red, fontSize: 15, marginTop: 14 }}>{formErr}</div>}

        <button type="submit" disabled={busy}
          style={{ width: "100%", marginTop: 22, minHeight: 60, borderRadius: 14, border: "none", background: submitColor, color: COLORS.sidebar, fontSize: 20, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Saving…" : submitText}
        </button>

        {recent.length > 0 && (
          <>
            <div style={{ ...labelStyle, marginTop: 34 }}>Recent on this phone</div>
            {recent.map((r) => (
              <div key={r.clientId} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderTop: `0.5px solid ${COLORS.border}`, fontSize: 15 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: TYPE_COLOR[r.type], fontFamily: "monospace" }}>{r.type === "out" ? "−" : r.type === "in" ? "+" : "⇄"} {money(r.amount, r.currency)}</div>
                  <div style={{ color: COLORS.textSecondary, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.category} · {r.who} · {r.date}{r.note ? ` · ${r.note}` : ""}</div>
                </div>
                <div style={{ fontSize: 13, whiteSpace: "nowrap", color: r.status === "saved" ? COLORS.green : r.status === "failed" ? COLORS.red : COLORS.amber }}>
                  {r.status === "saved" ? "✓ saved" : r.status === "failed" ? `✗ ${r.error || "rejected"}` : "⏳ waiting"}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 10 }}>To fix or delete an entry, use the Cashflow tab in the main app.</div>
          </>
        )}
      </form>
    </div>
  );
}
