import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import AnalyticsScreen from "../../components/client/AnalyticsScreen";
import { FONT_LINKS } from "../../components/client/ClientChrome";
import TourOverlay from "../../components/TourOverlay";
import { useTour } from "../../lib/useTour";
import UniversalSearch from "../../components/UniversalSearch";
import CsvImportPreview from "../../components/CsvImportPreview";

/**
 * pages/client/analytics.js — POS analytics screen, v5 shell.
 *
 * Data container only. Same reads as the current analytics page:
 *   - pos_sales, paged 1000 rows at a time up to 10k (identical to loadSalesData)
 *   - upload_sessions (the sync stamp)
 *   - menu_items (plate cost, so revenue arrives with its margin)
 *   - restaurants.target_food_cost
 * Rows are grouped into one entry per service night and handed to
 * components/client/AnalyticsScreen.js, which owns all markup.
 *
 * NOT carried over: the CSV upload pipeline (parse → column mapping →
 * duplicate detection → chunked insert) and the upload-history modal. Keep the
 * existing page as `analytics-upload.js`, or paste those pieces back in here —
 * see README-screens.md.
 */

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
const num = (v) => Number(v) || 0;
const dateOf = (s) => (typeof s.sale_date === "string" ? s.sale_date.slice(0, 10) : s.sale_date);
const labelOf = (iso) => {
  const [, m, d] = String(iso).split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
};
const dowOf = (iso) => (new Date(`${iso}T12:00:00`).getDay() + 6) % 7; // Mon = 0

const NavLink = ({ href, style, className, children }) => (
  <Link href={href} style={style} className={className}>{children}</Link>
);

export default function AnalyticsPage() {
  const tour = useTour("analytics");
  const router = useRouter();
  const fileInput = useRef(null);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/client/login");
  };

  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState(null);
  const [restaurantId, setRestaurantId] = useState(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [userName, setUserName] = useState("");
  const [targetFoodCost, setTargetFoodCost] = useState(30);
  const [sales, setSales] = useState([]);
  const [costs, setCosts] = useState({});   // lowercased item name -> plate cost
  const [session, setSession] = useState(null);

  const loadSales = useCallback(async (restId) => {
    let rows = [];
    for (let page = 0, from = 0; page < MAX_PAGES; page++, from += PAGE_SIZE) {
      const { data, error: qErr } = await supabase
        .from("pos_sales")
        .select("*")
        .eq("restaurant_id", restId)
        .order("sale_date", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (qErr || !data?.length) break;
      rows = rows.concat(data);
      if (data.length < PAGE_SIZE) break;
    }
    setSales(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.push("/client/login"); return; }
        const { data: profile } = await supabase
          .from("profiles").select("restaurant_id, full_name").eq("id", user.id).single();
        if (!profile?.restaurant_id) { setLoading(false); return; }
        if (cancelled) return;
        setRestaurantId(profile.restaurant_id);
        setUserName(profile.full_name || "");

        const [{ data: rest }, { data: menu }, { data: sessions }] = await Promise.all([
          supabase.from("restaurants").select("name, target_food_cost, deactivated_at").eq("id", profile.restaurant_id).single(),
          supabase.from("menu_items").select("name, price, cost, category").eq("restaurant_id", profile.restaurant_id).limit(500),
          supabase.from("upload_sessions").select("*").eq("restaurant_id", profile.restaurant_id).order("uploaded_at", { ascending: false }).limit(1),
        ]);
        if (cancelled) return;

        if (rest?.deactivated_at) {
          await supabase.auth.signOut();
          router.push("/client/login");
          return;
        }

        setRestaurantName(rest?.name || "");
        if (rest?.target_food_cost) setTargetFoodCost(num(rest.target_food_cost));
        setSession(sessions && sessions[0] ? sessions[0] : null);

        const map = {};
        (menu || []).forEach((m) => {
          map[String(m.name || "").toLowerCase().trim()] = { cost: num(m.cost), price: num(m.price), category: m.category };
        });
        setCosts(map);

        await loadSales(profile.restaurant_id);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load your sales");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router, loadSales]);

  /* pos_sales rows -> one night per date, with per-dish lines. */
  const days = useMemo(() => {
    const byDate = new Map();
    sales.forEach((s) => {
      const iso = dateOf(s);
      if (!iso) return;
      const night = byDate.get(iso) || { iso, items: new Map() };
      const name = s.item_name || "Item";
      const key = name.toLowerCase().trim();
      const menu = costs[key] || {};
      const qty = num(s.quantity_sold);
      const revenue = s.revenue != null ? num(s.revenue) : qty * num(s.unit_price || menu.price);
      const line = night.items.get(name) || {
        name,
        category: s.category || menu.category || "",
        price: num(s.unit_price) || menu.price || (qty ? revenue / qty : 0),
        cost: menu.cost || 0,
        qty: 0, rev: 0, cogs: 0,
      };
      line.qty += qty;
      line.rev += revenue;
      line.cogs += qty * (menu.cost || 0);
      night.items.set(name, line);
      byDate.set(iso, night);
    });

    return [...byDate.values()]
      .sort((a, b) => (a.iso < b.iso ? -1 : 1))
      .map((n) => ({
        date: n.iso,
        label: labelOf(n.iso),
        dow: dowOf(n.iso),
        weekend: dowOf(n.iso) >= 4,
        items: [...n.items.values()],
      }));
  }, [sales, costs]);

  /* Optional hour-of-day view — only when the export carried the column. */
  const hourly = useMemo(() => {
    const map = new Map();
    sales.forEach((s) => {
      const h = s.hour_of_day;
      if (h == null || h === "") return;
      const hour = Number(h);
      if (!isFinite(hour)) return;
      map.set(hour, (map.get(hour) || 0) + num(s.quantity_sold));
    });
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([hour, qty]) => ({ hour, qty }));
  }, [sales]);

  const syncStamp = session
    ? `${session.pos_system || "POS"} · ${Number(session.row_count || 0).toLocaleString("en-US")} rows through ${session.date_to || ""}`
    : sales.length
      ? `${sales[0].pos_system || "POS"} · ${sales.length.toLocaleString("en-US")} rows`
      : "";

  const initials = (userName || "Chef").split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  const [csvAnalysis, setCsvAnalysis] = useState(null);
  const [csvError, setCsvError] = useState("");

  async function handleFiles(fileList) {
    if (!fileList || !fileList.length || !restaurantId) return;
    const file = fileList[0]; // one file at a time — the preview step is per-file
    setCsvError("");
    try {
      const csvText = await file.text();
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/pos/analyze-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ csvText }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not read that file.");
      setCsvAnalysis({ ...json, csvText, filename: file.name });
    } catch (err) {
      console.error("[analytics] CSV analyze failed:", err);
      setCsvError(err.message);
    }
  }

  async function confirmCsvImport({ posSystem, columnMapping }) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/pos/confirm-csv", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ csvText: csvAnalysis.csvText, columnMapping, posSystem, filename: csvAnalysis.filename }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Import failed.");
    setCsvAnalysis(null);
    await loadSales(restaurantId);
  }

  return (
    <>
      <Head>
        <title>Analytics · OptiMenu</title>
        {FONT_LINKS}
      </Head>
      <input ref={fileInput} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
      <AnalyticsScreen
        days={days}
        hourly={hourly}
        targetFoodCost={Math.round(targetFoodCost)}
        posSystem={session?.pos_system || "POS"}
        syncStamp={syncStamp}
        loading={loading}
        error={error}
        onRetry={() => router.reload()}
        onUpload={() => fileInput.current && fileInput.current.click()}
        onSearch={() => setSearchOpen(true)}
        onSignOut={signOut}
        restaurantName={restaurantName || "Your restaurant"}
        user={{ initials: initials || "MR", firstName: (userName || "").split(" ")[0] || "Chef" }}
        NavLink={NavLink}
      />
      {tour.active && <TourOverlay tour={tour} />}

      <UniversalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {csvAnalysis && (
        <CsvImportPreview
          analysis={csvAnalysis}
          onConfirm={confirmCsvImport}
          onCancel={() => setCsvAnalysis(null)}
        />
      )}

      {csvError && (
        <div
          style={{
            position: "fixed", top: 16, right: 16, zIndex: 500, maxWidth: 340,
            background: "#faeae8", border: "1px solid #c4473e", borderRadius: 10,
            padding: "12px 16px", fontFamily: "'Manrope',sans-serif", fontSize: 13,
            color: "#c4473e", boxShadow: "0 10px 30px rgba(17,24,25,0.15)",
          }}
        >
          {csvError}
        </div>
      )}
    </>
  );
}