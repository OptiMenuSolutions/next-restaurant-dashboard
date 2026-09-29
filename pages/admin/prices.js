// pages/admin/prices.js
// Admin-only price review. Pick a restaurant, see every ingredient that still
// has only an AI estimate, ranked by how many dishes approving it would fully
// price, correct the price if needed, and approve in bulk.

import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { Shell, FONT_LINKS, LoadingState, ErrorState, MONO, SANS, PAGE_PAD, money } from "../../components/client/ClientChrome";

async function api(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}`, ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status });
  return json;
}

export default function AdminPrices() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [denied, setDenied] = useState(false);
  const [restaurants, setRestaurants] = useState([]);
  const [restaurantId, setRestaurantId] = useState("");
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [prices, setPrices] = useState({});   // id -> edited price string
  const [selected, setSelected] = useState({}); // id -> true
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function load(rid) {
    setLoading(true);
    setError(null);
    try {
      const data = await api(`/api/admin/price-review${rid ? `?restaurant_id=${rid}` : ""}`);
      setRestaurants(data.restaurants || []);
      setItems(data.items || []);
      setSummary(data.summary);
      setPrices(Object.fromEntries((data.items || []).map((i) => [i.id, i.estimate != null ? String(Math.round(i.estimate * 10000) / 10000) : ""])));
      setSelected({});
    } catch (e) {
      if (e.status === 403) setDenied(true);
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/client/login"); return; }
      load("");
    })();
  }, []);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const unlockTotal = useMemo(() => items.filter((i) => selected[i.id]).reduce((a, i) => a + i.unlocks, 0), [items, selected]);

  async function approve(ids) {
    const approvals = ids.map((id) => ({ id, price: Number(prices[id]) }));
    const bad = approvals.filter((a) => !(a.price > 0));
    if (bad.length) { setNotice(`${bad.length} selected item${bad.length === 1 ? " has" : "s have"} no price above $0. Fix or unselect ${bad.length === 1 ? "it" : "them"}.`); return; }
    setSaving(true);
    setNotice("");
    try {
      const out = await api("/api/admin/price-review", { method: "POST", body: JSON.stringify({ restaurant_id: restaurantId, approvals }) });
      setNotice(`Approved ${out.approved} price${out.approved === 1 ? "" : "s"}.${out.errors?.length ? ` ${out.errors.length} failed.` : ""}`);
      await load(restaurantId);
    } catch (e) {
      setNotice(e.message);
    } finally {
      setSaving(false);
    }
  }

  const cell = { padding: "10px 12px", borderBottom: "1px solid var(--line-soft)", fontSize: 13.5, verticalAlign: "middle" };
  const head = { ...cell, fontFamily: MONO, fontSize: 11, letterSpacing: "0.08em", color: "var(--faint)", textAlign: "left", fontWeight: 500, position: "sticky", top: 0, background: "var(--shell)" };
  const btn = (primary) => ({
    border: primary ? "none" : "1px solid var(--line)", background: primary ? "var(--accent)" : "var(--shell)",
    color: primary ? "#fff" : "var(--text)", borderRadius: 20, padding: "8px 16px", fontFamily: SANS, fontSize: 13, fontWeight: 700,
    cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
  });

  return (
    <>
      <Head>
        <title>Price review · OptiMenu admin</title>
        {FONT_LINKS}
      </Head>
      <Shell>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: `16px ${PAGE_PAD}`, borderBottom: "1px solid var(--line)", background: "var(--shell)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.03em" }}>OptiMenu admin</span>
            <span style={{ fontSize: 14, color: "var(--muted)" }}>Price review</span>
          </div>
          <Link href="/client/dashboard" style={{ fontSize: 13, color: "var(--accent-deep)", fontWeight: 600 }}>Back to dashboard</Link>
        </div>

        <div style={{ padding: `20px ${PAGE_PAD}`, background: "var(--panel)", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          {denied ? (
            <ErrorState message="This page is for OptiMenu admins only." />
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <select
                  value={restaurantId}
                  onChange={(e) => { setRestaurantId(e.target.value); setNotice(""); load(e.target.value); }}
                  style={{ fontFamily: SANS, fontSize: 14, padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--shell)", color: "var(--text)", minWidth: 280 }}
                >
                  <option value="">Choose a restaurant…</option>
                  {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                {summary && (
                  <span style={{ fontSize: 13.5, color: "var(--muted)" }}>
                    {summary.pricedDishes} of {summary.dishes} dishes fully priced, {summary.waiting} estimate{summary.waiting === 1 ? "" : "s"} waiting
                  </span>
                )}
              </div>

              {notice && <div style={{ fontSize: 13.5, color: "var(--accent-deep)", fontWeight: 600 }}>{notice}</div>}

              {loading ? (
                <LoadingState label="Loading estimates…" />
              ) : error ? (
                <ErrorState message={error} onRetry={() => load(restaurantId)} />
              ) : !restaurantId ? (
                <div style={{ fontSize: 14, color: "var(--muted)" }}>Choose a restaurant to review its AI price estimates.</div>
              ) : items.length === 0 ? (
                <div style={{ fontSize: 14, color: "var(--muted)" }}>Nothing to review. Every ingredient used on this menu has an invoice or approved price.</div>
              ) : (
                <div style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 13.5, color: "var(--muted)" }}>
                      {selectedIds.length ? `${selectedIds.length} selected, fully prices about ${unlockTotal} dish${unlockTotal === 1 ? "" : "es"}` : "Sorted by how many dishes each approval fully prices."}
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" disabled={saving || !selectedIds.length} onClick={() => approve(selectedIds)} style={btn(true)}>
                        Approve selected{selectedIds.length ? ` (${selectedIds.length})` : ""}
                      </button>
                    </div>
                  </div>
                  <div style={{ overflow: "auto", maxHeight: "calc(100vh - 260px)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: SANS }}>
                      <thead>
                        <tr>
                          <th style={{ ...head, width: 36 }}>
                            <input
                              type="checkbox"
                              aria-label="Select all"
                              checked={allSelected}
                              onChange={(e) => setSelected(e.target.checked ? Object.fromEntries(items.map((i) => [i.id, true])) : {})}
                            />
                          </th>
                          <th style={head}>Ingredient</th>
                          <th style={head}>AI estimate</th>
                          <th style={head}>Reference</th>
                          <th style={{ ...head, textAlign: "right" }}>Used in</th>
                          <th style={{ ...head, textAlign: "right" }}>Fully prices</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((i) => (
                          <tr key={i.id} style={{ background: selected[i.id] ? "var(--accent-tint)" : "transparent" }}>
                            <td style={cell}>
                              <input
                                type="checkbox"
                                aria-label={`Select ${i.name}`}
                                checked={!!selected[i.id]}
                                onChange={(e) => setSelected((s) => ({ ...s, [i.id]: e.target.checked }))}
                              />
                            </td>
                            <td style={{ ...cell, fontWeight: 600 }}>{i.name}</td>
                            <td style={cell}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <span style={{ color: "var(--faint)" }}>$</span>
                                <input
                                  value={prices[i.id] ?? ""}
                                  onChange={(e) => setPrices((p) => ({ ...p, [i.id]: e.target.value.replace(/[^0-9.]/g, "") }))}
                                  inputMode="decimal"
                                  aria-label={`Price per ${i.unit} for ${i.name}`}
                                  style={{ width: 84, fontFamily: MONO, fontSize: 13, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--shell)", color: "var(--text)" }}
                                />
                                <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--faint)" }}>/{i.unit}</span>
                              </span>
                            </td>
                            <td style={{ ...cell, fontFamily: MONO, fontSize: 12.5, color: "var(--muted)" }}>
                              {i.reference ? `${money(i.reference.price, 4)}${i.reference.unit ? "/" + i.reference.unit : ""}` : "none"}
                            </td>
                            <td style={{ ...cell, textAlign: "right", fontFamily: MONO, fontSize: 12.5 }}>{i.uses} dish{i.uses === 1 ? "" : "es"}</td>
                            <td style={{ ...cell, textAlign: "right", fontFamily: MONO, fontSize: 12.5, fontWeight: i.unlocks ? 700 : 400, color: i.unlocks ? "var(--accent-deep)" : "var(--faint)" }}>
                              {i.unlocks || "0"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Shell>
    </>
  );
}