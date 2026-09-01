import React, { useMemo, useState } from "react";
import {
  Shell, Header, MobileHeader, MobileNav, LoadingState, EmptyState, ErrorState,
  useTheme, useIsMobile, MONO, SANS, PAGE_PAD, SearchIcon, money, money0,
} from "./ClientChrome";

/**
 * InvoicesScreen — ported from "OptiMenu Invoices.dc.html".
 *
 * Presentational only: list + receipt-paper detail pane, month spend, filters,
 * light/dark, mobile and empty states. Falls back to DEMO_INVOICES when no
 * `invoices` prop is given, so it renders standalone before wiring.
 *
 * Props
 *   invoices   [Invoice]  – see DEMO_INVOICES for the shape:
 *              { id, number, file, supplier, date (Date|ISO|string), amount (number|null),
 *                status: "processed"|"pending"|"review",
 *                items: [{ name, qty, unitCost, link }] }
 *   loading    boolean
 *   error      string | null
 *   onRetry    () => void
 *   onUpload   () => void            – open the existing uploader
 *   onOpen     (invoice) => void     – "open full invoice" / row double-click target
 *   onFlag     (invoice) => void
 *   onSelect   (invoice) => void     – fires when a row is picked (use to lazy-load line items)
 *   restaurantName string
 *   periodLabel    string   e.g. "August 2026"
 *   lastUploadLabel string
 *   theme / defaultTheme / onThemeChange, activeNav-free: nav is fixed to "invoices"
 *   NavLink    component – ({href, style, className, children}) wrapper around next/link
 */

const STATUS = {
  processed: { label: "Processed", color: "var(--green)", bg: "rgba(63,156,86,0.12)", mark: "transparent" },
  pending: { label: "Pending review", color: "var(--amber)", bg: "rgba(193,135,28,0.14)", mark: "var(--amber)" },
  review: { label: "Needs your OK", color: "var(--red)", bg: "rgba(196,71,62,0.12)", mark: "var(--red)" },
};

const COLUMNS = [
  { label: "Invoice", align: "left" },
  { label: "Supplier", align: "left" },
  { label: "Date", align: "right" },
  { label: "Lines", align: "right" },
  { label: "Amount", align: "right" },
];

const GRID = "1.35fr 1fr 0.72fr 0.55fr 0.78fr";

export const DEMO_INVOICES = [
  { id: 1, number: "INV-88214", file: "sysco-aug23.pdf", supplier: "Sysco Northeast", date: "AUG 23", status: "processed", items: [
    { name: "Duck breast, magret", qty: "12 EA", unitCost: 18.4, link: "Duck breast" },
    { name: "Heavy cream 36%", qty: "8 L", unitCost: 4.15, link: "Heavy cream" },
    { name: "Sour cherries, frozen", qty: "4 KG", unitCost: 9.8, link: "Sour cherries" },
    { name: "Demi-glace, veal", qty: "2 L", unitCost: 31.0, link: "Demi-glace" },
    { name: "Hazelnuts, blanched", qty: "3 KG", unitCost: 14.25, link: "Hazelnuts" },
    { name: "Caster sugar", qty: "10 KG", unitCost: 2.1, link: "Caster sugar" },
    { name: "Delivery surcharge", qty: "1 EA", unitCost: 45.0, link: null },
  ] },
  { id: 2, number: "INV-88190", file: "baldor-aug22.jpg", supplier: "Baldor Produce", date: "AUG 22", status: "processed", items: [
    { name: "Broccolini", qty: "14 KG", unitCost: 8.6, link: "Broccolini" },
    { name: "Turnips, hakurei", qty: "10 KG", unitCost: 5.4, link: "Turnip" },
    { name: "Lemons, case", qty: "2 CS", unitCost: 42.0, link: "Lemon" },
    { name: "Thyme, bunch", qty: "12 EA", unitCost: 2.25, link: "Thyme" },
    { name: "Calabrian chili, jar", qty: "4 EA", unitCost: 11.5, link: null },
  ] },
  { id: 3, number: null, file: "photo-aug24.heic", supplier: "Murray’s Cheese", date: "AUG 24", status: "pending", items: [] },
  { id: 4, number: "INV-88101", file: "bakery-aug21.pdf", supplier: "Balthazar Bakery", date: "AUG 21", status: "processed", items: [
    { name: "Country loaf", qty: "30 EA", unitCost: 6.25, link: "Country loaf" },
    { name: "Focaccia sheet", qty: "8 EA", unitCost: 15.0, link: "Focaccia" },
  ] },
  { id: 5, number: "INV-87944", file: "winesearch-aug20.pdf", supplier: "Vine & Barrel", date: "AUG 20", amount: 1980.0, status: "review", items: [
    { name: "Barbera d’Alba, case", qty: "6 CS", unitCost: 168.0, link: null },
    { name: "Vermentino, case", qty: "4 CS", unitCost: 142.0, link: null },
    { name: "Grappa, 700ml", qty: "6 EA", unitCost: 38.0, link: null },
  ] },
  { id: 6, number: "INV-87903", file: "sysco-aug19.pdf", supplier: "Sysco Northeast", date: "AUG 19", status: "processed", items: [
    { name: "Duck fat, rendered", qty: "4 KG", unitCost: 12.9, link: "Duck fat" },
    { name: "Egg yolk, pasteurized", qty: "5 L", unitCost: 9.4, link: "Egg yolk" },
    { name: "Pecorino romano", qty: "6 KG", unitCost: 21.75, link: "Pecorino" },
    { name: "Olive oil, blend 5L", qty: "4 EA", unitCost: 46.0, link: "Olive oil" },
  ] },
  { id: 7, number: "INV-87860", file: "seafood-aug18.pdf", supplier: "Pierless Fish", date: "AUG 18", status: "processed", items: [
    { name: "Branzino, whole", qty: "18 EA", unitCost: 27.8, link: "Branzino" },
    { name: "Clams, littleneck", qty: "10 KG", unitCost: 14.6, link: "Clams" },
    { name: "Squid, cleaned", qty: "6 KG", unitCost: 18.2, link: "Squid" },
  ] },
  { id: 8, number: "INV-87812", file: "dairy-aug17.pdf", supplier: "Ronnybrook Dairy", date: "AUG 17", status: "processed", items: [
    { name: "Butter, cultured 82%", qty: "12 KG", unitCost: 13.2, link: "Butter" },
    { name: "Whole milk", qty: "20 L", unitCost: 2.85, link: "Whole milk" },
    { name: "Crème fraîche", qty: "6 EA", unitCost: 9.5, link: null },
  ] },
];

const lineTotal = (i) => (Number(i.unitCost) || 0) * (parseFloat(i.qty) || 0);
const sumItems = (items) => (items || []).reduce((a, i) => a + lineTotal(i), 0);

function resolveAmount(v) {
  if (v.amount != null) return Number(v.amount);
  if (v.status === "pending") return null;
  return Math.round(sumItems(v.items) * 100) / 100;
}

export default function InvoicesScreen({
  invoices: invoicesProp,
  loading = false,
  error = null,
  onRetry,
  onUpload,
  onOpen,
  onFlag,
  onSelect,
  onSearch,
  onSignOut,
  restaurantName = "Trattoria Lume",
  periodLabel = "August 2026",
  lastUploadLabel = "",
  user,
  theme: themeProp,
  defaultTheme = "light",
  onThemeChange,
  NavLink,
  logoSrc,
  logoDarkSrc,
}) {
  const [theme, toggleTheme] = useTheme(themeProp, defaultTheme, onThemeChange);
  const isMobile = useIsMobile(900);
  const [selectedId, setSelectedId] = useState(null);

  const list = invoicesProp || DEMO_INVOICES;
  const rows = useMemo(
    () => list.map((v, i) => ({ ...v, id: v.id != null ? v.id : i, amount: resolveAmount(v) })),
    [list]
  );

  const selected = rows.find((v) => v.id === selectedId) || rows[0];
  const monthSpend = rows.reduce((a, v) => a + (v.amount || 0), 0);
  const pendingCount = rows.filter((v) => v.status !== "processed").length;
  const countLabel = `Showing ${rows.length} of ${rows.length} invoices`;

  const pick = (v) => {
    setSelectedId(v.id);
    if (onSelect) onSelect(v);
  };

  const chrome = (
    <Header
      active="invoices"
      NavLink={NavLink}
      user={user}
      restaurantName={restaurantName}
      theme={theme}
      onToggleTheme={toggleTheme}
      onSearch={onSearch}
      onSignOut={onSignOut}
      logoSrc={logoSrc}
      logoDarkSrc={logoDarkSrc}
    />
  );

  if (loading) return <Shell theme={theme}>{chrome}<LoadingState label="Reading your invoices…" /></Shell>;
  if (error) return <Shell theme={theme}>{chrome}<ErrorState message={error} onRetry={onRetry} /></Shell>;

  if (!rows.length) {
    return (
      <Shell theme={theme}>
        {chrome}
        <EmptyState
          kicker="No invoices yet"
          title="Drop in your first delivery invoice"
          body="Photograph or export it — PDF, JPG or PNG. We read the supplier, the date, and every line item, then price your ingredients from it. Most invoices come back within a few hours."
        >
          <div style={{ width: "100%", marginTop: 8, border: "1.5px dashed var(--line)", borderRadius: 14, background: "var(--shell)", padding: "30px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)" }}>Drag files here</div>
            <button type="button" onClick={onUpload} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 24, padding: "12px 26px", fontFamily: SANS, fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 24px rgba(2,164,186,0.28)" }}>Choose files</button>
          </div>
        </EmptyState>
      </Shell>
    );
  }

  if (isMobile) {
    return (
      <Shell theme={theme}>
        <MobileHeader theme={theme} onToggleTheme={toggleTheme} user={user} logoSrc={logoSrc} logoDarkSrc={logoDarkSrc} />
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.03em" }}>Invoices</div>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.08em", color: "var(--faint)", marginTop: 3 }}>{countLabel}</div>
          </div>
          <button type="button" onClick={onUpload} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 20, padding: "9px 16px", fontFamily: SANS, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>↑ Upload</button>
        </div>
        <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 10, background: "var(--panel)" }}>
          {rows.map((v) => {
            const m = STATUS[v.status] || STATUS.processed;
            return (
              <div key={v.id} onClick={() => (onOpen ? onOpen(v) : pick(v))} style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 8, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>{v.supplier}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: v.amount == null ? "var(--faint)" : "var(--text)" }}>{v.amount == null ? "—" : money(v.amount)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--faint)" }}>
                    {(v.number || "Awaiting number") + " · " + v.date + " · " + (v.items && v.items.length ? v.items.length + " items" : "—")}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", borderRadius: 12, padding: "3px 8px", color: m.color, background: m.bg }}>{m.label}</span>
                </div>
              </div>
            );
          })}
        </div>
        <MobileNav active="invoices" NavLink={NavLink} />
      </Shell>
    );
  }

  return (
    <Shell theme={theme} style={{ height: "100vh", overflow: "hidden" }}>
      {chrome}
      <div style={{ padding: `16px ${PAGE_PAD} 20px`, display: "flex", flexDirection: "column", gap: 14, background: "var(--panel)", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 5 }}>{restaurantName} · Purchasing</div>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1 }}>
              Invoices <span style={{ color: "var(--faint)" }}>· {periodLabel}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7, paddingRight: 6 }}>
              <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)" }}>Spend this month</span>
              <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{money0(monthSpend)}</span>
            </div>
            <button type="button" onClick={onSearch} className="om-hover-accent" style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 20, padding: "7px 12px", cursor: "pointer", fontFamily: SANS }}>
              <SearchIcon size={13} />
              <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Search supplier or number</span>
            </button>
            <button type="button" onClick={onUpload} style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 22, padding: "9px 18px", fontFamily: SANS, fontSize: 12.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 20px rgba(2,164,186,0.26)", whiteSpace: "nowrap" }}>↑ Upload invoice</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
          <div data-tour="inv-list" style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "11px 16px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
              {COLUMNS.map((c) => (
                <span key={c.label} style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", textAlign: c.align }}>{c.label}</span>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {rows.map((v) => {
                const active = selected && v.id === selected.id;
                return (
                  <div
                    key={v.id}
                    data-tour="inv-row"
                    className="om-row"
                    onClick={() => pick(v)}
                    onDoubleClick={() => onOpen && onOpen(v)}
                    style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer", background: active ? "var(--accent-tint)" : "transparent", borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}` }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: v.number ? "var(--text)" : "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.number || "Awaiting number"}</div>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.supplier}</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap" }}>{v.date}</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--faint)", textAlign: "right", whiteSpace: "nowrap" }}>{v.items && v.items.length ? v.items.length + " items" : "—"}</div>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: v.amount == null ? "var(--faint)" : "var(--text)" }}>{v.amount == null ? "—" : money(v.amount)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--line)", flexShrink: 0, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>
              <span>{countLabel}</span>
              <span>{lastUploadLabel || (pendingCount ? pendingCount + " awaiting review" : "All invoices processed")}</span>
            </div>
          </div>

          <Receipt invoice={selected} onOpen={onOpen} onFlag={onFlag} />
        </div>
      </div>
    </Shell>
  );
}

function Receipt({ invoice, onOpen, onFlag }) {
  if (!invoice) return null;
  const s = invoice;
  const meta = STATUS[s.status] || STATUS.processed;
  const items = s.items || [];
  const itemsTotal = sumItems(items);
  const diff = s.amount == null ? 0 : Math.abs(itemsTotal - s.amount);
  const unmatched = items.filter((i) => !i.link).length;
  const year = s.year || new Date().getFullYear();

  const fields = [
    { label: "INVOICE NO.", value: s.number || "Pending review", color: s.number ? "var(--ink)" : "var(--amber)" },
    { label: "INVOICE DATE", value: `${s.date}, ${year}`, color: "var(--ink)" },
    { label: "UPLOADED", value: s.file || "—", color: "var(--ink-soft)" },
    { label: "STATUS", value: meta.label, color: meta.color },
  ];

  const primaryAction =
    s.status === "processed"
      ? unmatched
        ? `· · · LINK ${unmatched} ITEMS · · ·`
        : "· · · OPEN FULL INVOICE · · ·"
      : "· · · REVIEW & CONFIRM · · ·";

  const btn = { background: "none", border: "1px dashed var(--ink-faint)", borderRadius: 4, padding: 9, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: "var(--ink-soft)", cursor: "pointer" };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div data-tour="inv-detail" style={{ flex: 1, minHeight: 0, position: "relative", animation: "om-print .45s cubic-bezier(.25,.8,.35,1) both" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "var(--paper)", color: "var(--ink)", fontFamily: MONO, borderRadius: 4, padding: "14px 16px 16px", boxShadow: "var(--shadow-lg)", overflowY: "auto", overflowX: "hidden" }}>
          {s.fileUrl ? (
            <a href={s.fileUrl} target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", alignSelf: "flex-end", flexShrink: 0 }}>View original ↗</a>
          ) : (
            <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", alignSelf: "flex-end", flexShrink: 0, color: "var(--ink-faint)" }}>No file</span>
          )}
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em" }}>{s.supplier}</div>
            <div style={{ fontSize: 8.5, letterSpacing: "0.16em", color: "var(--ink-faint)", marginTop: 3 }}>{(s.number || "NO NUMBER YET") + " · " + s.date + " " + year}</div>
          </div>
          <div style={{ borderTop: "1px dashed var(--paper-line)", margin: "11px 0" }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", flexShrink: 0 }}>
            {fields.map((f) => (
              <div key={f.label}>
                <div style={{ fontSize: 8, letterSpacing: "0.14em", color: "var(--ink-faint)" }}>{f.label}</div>
                <div style={{ fontSize: 11, color: f.color, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.value}</div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: "1px dashed var(--paper-line)", margin: "11px 0" }} />
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", fontSize: 8, letterSpacing: "0.14em", color: "var(--ink-faint)", flexShrink: 0 }}>
            <span>LINE ITEMS</span>
            <span>{items.length ? `${items.length} LINES · ${unmatched} UNMATCHED` : "NOT READ YET"}</span>
          </div>
          <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden", marginTop: 9 }}>
            {items.map((i, n) => (
              <div key={n} style={{ padding: "5px 0" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span style={{ fontSize: 10.5, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.name}</span>
                  <span style={{ flex: 1, borderBottom: "1px dotted var(--ink-faint)", transform: "translateY(-3px)" }} />
                  <span style={{ fontSize: 10.5, color: "var(--ink)", whiteSpace: "nowrap" }}>{money(lineTotal(i))}</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
                  <span style={{ fontSize: 9, color: "var(--ink-faint)", whiteSpace: "nowrap" }}>{i.qty} @ {money(i.unitCost)}</span>
                  <span style={{ fontSize: 9, letterSpacing: "0.06em", color: i.link ? "var(--green)" : "var(--amber)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {i.link ? "→ " + i.link : "▲ not linked to an ingredient"}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: "1px dashed var(--paper-line)", margin: "10px 0", flexShrink: 0 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", fontSize: 10, color: "var(--ink-soft)" }}>
              <span>ITEMS TOTAL</span><span>{items.length ? money(itemsTotal) : "—"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>
              <span style={{ letterSpacing: "0.08em" }}>INVOICE TOTAL</span><span>{s.amount == null ? "PENDING" : money(s.amount)}</span>
            </div>
            {s.amount != null && diff > 0.01 && (
              <div style={{ fontSize: 9.5, letterSpacing: "0.06em", color: "var(--red)", marginTop: 2 }}>
                ▲ Line items are off by {money(diff)} — check for tax or a missed line
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 12, flexShrink: 0 }}>
            <button type="button" onClick={() => onOpen && onOpen(s)} className="om-hover-accent" style={{ ...btn, flex: 1 }}>{primaryAction}</button>
            <button type="button" onClick={() => onFlag && onFlag(s)} className="om-hover-accent" style={{ ...btn, padding: "9px 12px" }}>FLAG</button>
          </div>
        </div>
      </div>
    </div>
  );
}