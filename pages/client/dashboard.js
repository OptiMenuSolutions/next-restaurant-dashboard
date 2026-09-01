import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { computeWasteRisk } from "../../lib/computeWasteRisk";
import { computeWasteResolution } from "../../lib/computeWasteResolution";
import { useWeekInReview } from "../../lib/useWeekInReview";
import PassDashboard from "../../components/dashboard/PassDashboard";
import WasteConfirmationModal from "../../components/dashboard/WasteConfirmationModal";
import TourOverlay from "../../components/TourOverlay";
import { useTour } from "../../lib/useTour";
import { fetchSampleData, SAMPLE_AI_RECOMMENDATIONS } from "../../lib/seedSampleData";
import UniversalSearch from "../../components/UniversalSearch";

/**
 * pages/client/dashboard.js — "Tonight's Pass" dashboard, v5 shell.
 *
 * This file is the data container only: same auth guard and same five queries
 * as the current dashboard.js / dashboard3.js, then a set of adapters that map
 * rows onto the presentational component's props. All markup lives in
 * components/dashboard/PassDashboard.js.
 */

const TICKET_META = [
  { label: "PUSH TONIGHT", color: "var(--accent-deep)", urgency: "HIGH" },
  { label: "RECOMMEND", color: "var(--green)", urgency: "MEDIUM" },
  { label: "MENTION", color: "var(--amber)", urgency: "LOW" },
];

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const money = (n) => "$" + Math.round(n || 0).toLocaleString();

/* Monday-first weekday index of the 1st of the given month. */
function firstWeekdayIndex(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1).getDay(); // 0 = Sun
  return (d + 6) % 7;
}

/* Recommendation row -> ticket. Point `recs` at whatever the current page
   already produces (the AI recommendation call / selectedRec source). */
/* The real /api/ai-recommendations response only ever returns
   {title, description, talking_point, type, margin, confidence, urgency} —
   no recipe/ingredient data. Ported from dashboard3.js's PassTicket: match
   each rec's title against the real menu item (exact, then substring
   fallback) to build the recipe view and cover-margin figure. */
function toTickets(recs, wasteRisk, menuItems) {
  const atRisk = new Set((wasteRisk || []).map((w) => String(w.name || "").toLowerCase().trim()));
  return (recs || []).slice(0, 3).map((r, i) => {
    const key = (r.title || "").toLowerCase().trim();
    const item = key
      ? (menuItems || []).find((m) => (m.name || "").toLowerCase().trim() === key) ||
        (menuItems || []).find((m) => (m.name || "").toLowerCase().includes(key))
      : null;

    const recipe = (item?.menu_item_components || []).map((c) => ({
      name: c.name,
      ings: (c.component_ingredients || [])
        .map((ci) => {
          const name = (ci.ingredients?.name || "").trim();
          return {
            name,
            qty: [ci.quantity, ci.unit].filter(Boolean).join(" "),
            risk: atRisk.has(name.toLowerCase()),
          };
        })
        .filter((g) => g.name),
    }));

    const riskCount = recipe.reduce((n, c) => n + c.ings.filter((g) => g.risk).length, 0);
    const price = item ? parseFloat(item.price || 0) : 0;
    const cost = item ? parseFloat(item.cost || 0) : 0;
    // coverMargin (dollar profit/cover) is computed from the matched menu
    // item; marginVal (the % chip) uses the AI's own r.margin directly —
    // same split PassTicket used, not the same number twice.
    const coverMargin = price > 0 && cost > 0 ? price - cost : null;
    const marginVal = r.margin != null && !isNaN(parseFloat(r.margin)) ? parseFloat(r.margin) : null;

    return {
      ...TICKET_META[i],
      num: "#" + String(r.id || i + 1).slice(-3).padStart(3, "0") + "-0" + (i + 1),
      title: r.title,
      pitch: r.talkingPoint || r.description || "",
      reason: r.description || "",
      margin: marginVal != null ? "MARGIN " + Math.round(marginVal) + "%" : "",
      cover: coverMargin != null ? "$" + coverMargin.toFixed(2) + "/COVER" : "",
      recipe,
      riskNote: riskCount
        ? "▲ " + riskCount + (riskCount === 1 ? " ingredient" : " ingredients") +
          " at risk tonight — selling this clears " + (riskCount === 1 ? "it" : "them")
        : "",
    };
  });
}

// Matches SAMPLE_RESTAURANT_ID in lib/seedSampleData.js exactly — used to
// point Week in Review at the sample restaurant's real history during a
// tour, instead of the signed-in user's own (likely brand-new, empty) one.
const SAMPLE_RESTAURANT_ID = "00000000-0000-0000-0000-000000000001";

/* Same detection useTour uses internally — kept independent rather than
   reading it off the hook, so this file's data-loading isn't coupled to the
   overlay's own state/timing. */
function isTourQueryActive() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("tour") !== "true") return false;
  try {
    return localStorage.getItem("optimenu_tour_done") !== "1";
  } catch {
    return true;
  }
}

/* fetchSampleData()'s invoices nest invoice_items forward
   (invoice.invoice_items[]); computeWasteRisk expects invoiceItems with
   invoices nested backward (item.invoices.date) — flatten one into the
   other rather than changing computeWasteRisk's contract for one caller. */
function flattenSampleInvoiceItems(sampleInvoices) {
  const out = [];
  for (const inv of sampleInvoices || []) {
    for (const item of inv.invoice_items || []) {
      out.push({ ...item, invoice_id: inv.id, invoices: { id: inv.id, date: inv.date, restaurant_id: inv.restaurant_id } });
    }
  }
  return out;
}

function toWaste(wasteRisk) {
  return (wasteRisk || []).map((w) => {
    const dl = w.daysLeft != null ? w.daysLeft : 7;
    const qtyLabel = w.remainingQty != null
      ? Math.round(w.remainingQty * 100) / 100 + (w.unit ? " " + w.unit : "") + " remaining"
      : "";
    return {
      name: w.name,
      qty: qtyLabel,
      left: dl <= 0 ? "Use today" : dl === 1 ? "1 day left" : dl + " days left",
      tone: dl <= 1 ? "today" : dl <= 2 ? "soon" : "ok",
      pct: w.shelfLife ? Math.min(100, Math.round(((w.shelfLife - dl) / w.shelfLife) * 100)) : 50,
    };
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const tour = useTour("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState("");
  const [restaurantName, setRestaurantName] = useState("Your Restaurant");
  const [restaurantCreatedAt, setRestaurantCreatedAt] = useState(null);
  const [targetFoodCost, setTargetFoodCost] = useState(null);
  const [wasteResolution, setWasteResolution] = useState(null);
  const [pendingConfirmations, setPendingConfirmations] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [data, setData] = useState({ ingredients: [], menuItems: [], wasteRisk: [], stats: null });
  const [reloadKey, setReloadKey] = useState(0);

  // Computed fresh each render (not stored state) — re-evaluates whenever
  // this component re-renders, which happens reliably when the tour ends
  // (useTour's done() calls setTourOn(false) in this same component tree).
  // Included in effect dependency arrays below so those effects correctly
  // re-fetch real data once the tour finishes, rather than sample data
  // silently lingering for the rest of the session.
  const tourActive = isTourQueryActive();

  /* ── auth ── */
  useEffect(() => {
    (async () => {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) { setError("Authentication required"); setLoading(false); return; }
        const { data: profile, error: profileError } = await supabase
          .from("profiles").select("restaurant_id,full_name").eq("id", user.id).single();
        if (profileError || !profile?.restaurant_id) {
          setError("Could not determine restaurant access"); setLoading(false); return;
        }
        setUserName(profile.full_name || "");
        setRestaurantId(profile.restaurant_id);
        const { data: rd } = await supabase
          .from("restaurants")
          .select("name,created_at,target_food_cost,deactivated_at")
          .eq("id", profile.restaurant_id)
          .single();

        // A still-valid session doesn't stop working just because the
        // account was deactivated elsewhere (another tab, another device,
        // or a session that predates the deactivation) — deactivation only
        // ever set a column, it never revoked existing tokens. This is the
        // actual enforcement point: sign out and send them to login, where
        // the existing reactivation prompt (see login.js) takes over.
        if (rd?.deactivated_at) {
          await supabase.auth.signOut();
          router.push("/client/login");
          return;
        }

        if (rd?.name) setRestaurantName(rd.name);
        if (rd?.created_at) setRestaurantCreatedAt(rd.created_at);
        if (rd?.target_food_cost != null) setTargetFoodCost(Number(rd.target_food_cost));
      } catch {
        setError("An unexpected error occurred"); setLoading(false);
      }
    })();
  }, [reloadKey]);

  /* ── data ── */
  useEffect(() => {
    if (!restaurantId) return;
    (async () => {
      try {
        setLoading(true);

        if (tourActive) {
          const sample = await fetchSampleData();
          if (sample) {
            const sampleInvoiceItems = flattenSampleInvoiceItems(sample.invoices);
            const wasteRisk = computeWasteRisk(sampleInvoiceItems, sample.invoices || [], sample.posSales || [], sample.menuItems || []);
            const priced = (sample.menuItems || []).filter((m) => m.price > 0 && m.cost > 0);
            const margins = priced.map((m) => ((m.price - m.cost) / m.price) * 100);
            const pctAbove50 = margins.length ? margins.filter((m) => m >= 50).length / margins.length : 0;
            const pctBelow25 = margins.length ? margins.filter((m) => m < 25).length / margins.length : 0;
            const ytdSpend = (sample.invoices || [])
              .filter((iv) => new Date(iv.date).getFullYear() === new Date().getFullYear())
              .reduce((s, iv) => s + (Number(iv.amount) || 0), 0);

            setData({
              ingredients: sample.ingredients || [],
              menuItems: sample.menuItems || [],
              wasteRisk,
              stats: {
                avgMargin: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0,
                lowMargin: margins.filter((m) => m < 50).length,
                expiring: wasteRisk.length,
                ytdSpend,
                pctAbove50,
                pctBelow25,
              },
            });
            setLoading(false);
            return;
          }
          // fetchSampleData() returned null (a fetch error) — fall through
          // to the real query path below rather than leave the tour blank.
        }

        const from = new Date(); from.setDate(from.getDate() - 90);
        const fromDate = from.toISOString().split("T")[0];
        const [{ data: invoices }, { data: ingredients }, { data: menuItems }, { data: invoiceItems }, { data: posSales }] =
          await Promise.all([
            supabase.from("invoices").select("*").eq("restaurant_id", restaurantId).order("date", { ascending: false }),
            supabase.from("ingredients").select("*").eq("restaurant_id", restaurantId).limit(1000),
            supabase.from("menu_items")
              .select("id,name,price,cost,category,menu_item_components(id,name,cost,component_ingredients(quantity,unit,ingredients(id,name,last_price,is_estimated)))")
              .eq("restaurant_id", restaurantId).limit(500),
            supabase.from("invoice_items").select("*,invoices!inner(id,date,restaurant_id)")
              .eq("invoices.restaurant_id", restaurantId).gte("invoices.date", fromDate)
              .order("invoices(date)", { ascending: true }),
            supabase.from("pos_sales").select("item_name,quantity_sold,sale_date")
              .eq("restaurant_id", restaurantId).gte("sale_date", fromDate),
          ]);

        const wasteRisk = computeWasteRisk(invoiceItems || [], invoices || [], posSales || [], menuItems || []);
        const priced = (menuItems || []).filter((m) => m.price > 0 && m.cost > 0);
        const margins = priced.map((m) => ((m.price - m.cost) / m.price) * 100);
        const pctAbove50 = margins.length ? margins.filter((m) => m >= 50).length / margins.length : 0;
        const pctBelow25 = margins.length ? margins.filter((m) => m < 25).length / margins.length : 0;
        const ytdSpend = (invoices || [])
          .filter((iv) => new Date(iv.date).getFullYear() === new Date().getFullYear())
          .reduce((s, iv) => s + (Number(iv.amount) || 0), 0);

        setData({
          ingredients: ingredients || [],
          menuItems: menuItems || [],
          wasteRisk,
          stats: {
            avgMargin: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0,
            lowMargin: margins.filter((m) => m < 50).length,
            expiring: wasteRisk.length,
            ytdSpend,
            pctAbove50,
            pctBelow25,
          },
        });
        setLoading(false);
      } catch (err) {
        setError("Failed to fetch dashboard data: " + err.message);
        setLoading(false);
      }
    })();
  }, [restaurantId, reloadKey, tourActive]);

  // Which month the desktop calendar is currently browsing. Defaults to the
  // current month; useWeekInReview always fetches the trailing 7 days too
  // (for the "last 7 nights" summary stats), so browsing history doesn't
  // lose that regardless of what month is in view.
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const isCurrentMonth = viewDate.year === new Date().getFullYear() && viewDate.month === new Date().getMonth();
  const monthRangeFrom = new Date(viewDate.year, viewDate.month, 1).toISOString().split("T")[0];
  const monthRangeTo = new Date(viewDate.year, viewDate.month + 1, 0).toISOString().split("T")[0];

  const goToPrevMonth = () => {
    setViewDate((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }));
  };
  const goToNextMonth = () => {
    if (isCurrentMonth) return; // never browse into the future
    setViewDate((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }));
  };

  const { weekData, weekExtraSold, weekWasteSaved, hitRate, loading: weekLoading } =
    useWeekInReview(
      tourActive ? SAMPLE_RESTAURANT_ID : restaurantId,
      data.wasteRisk,
      data.menuItems,
      monthRangeFrom,
      monthRangeTo
    );

  // Mobile's Week tab has no month-browsing UI — it always means "the last
  // 7 nights," regardless of what month desktop is currently viewing. Once
  // a month range is requested, `weekData` contains the union of that month
  // and the trailing 7 days, so mobile needs its own filtered slice rather
  // than reading the same array desktop's calendar uses.
  const last7WeekData = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 6);
    const start = cutoff.toISOString().split("T")[0];
    return (weekData || []).filter((d) => d.date >= start);
  }, [weekData]);

  useEffect(() => {
    if (!restaurantId) return;
    (async () => {
      if (tourActive) {
        // Hardcoded specifically so the tour doesn't wait on (or pay for) a
        // real Claude API call. Note: these titles are headline-style
        // ("Push Waffle Fries at Lunch"), not exact dish names — unlike
        // SAMPLE_DISH_RECS in the same file, which does use real dish
        // names. That mismatch means toTickets()'s fuzzy match against
        // menu items won't find a dish for these, so sample tickets show
        // title+description but no recipe on flip. Pre-existing in the
        // sample content itself, not something introduced here.
        setRecommendations(
          SAMPLE_AI_RECOMMENDATIONS.map((r) => ({
            title: r.title,
            description: r.description,
            talkingPoint: r.talking_point || null,
            type: r.type || null,
            margin: r.margin || null,
            confidence: r.confidence || null,
            urgency: r.urgency || null,
          }))
        );
        return;
      }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/ai-recommendations", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ restaurantId }),
        });
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = await res.json();
        setRecommendations(
          (json.recommendations || []).map((r) => ({
            title: r.title,
            description: r.description,
            talkingPoint: r.talking_point || null,
            type: r.type,
            margin: r.margin || null,
            confidence: r.confidence || null,
            urgency: r.urgency || null,
          }))
        );
      } catch (err) {
        console.error("[fetchAIRecommendations]", err);
        setRecommendations([]);
      }
    })();
  }, [restaurantId, reloadKey, tourActive]);

  useEffect(() => {
    if (!restaurantId) return;
    (async () => {
      try {
        const result = await computeWasteResolution(supabase, restaurantId, 30);
        setWasteResolution(result);
      } catch (err) {
        console.error("Failed to compute waste resolution:", err);
        setWasteResolution({ resolvedViaRecommendation: 0, wasted: 0, resolutionRate: null });
      }
    })();
  }, [restaurantId, reloadKey]);

  useEffect(() => {
    // Skip entirely during a tour — the sample restaurant has no
    // waste_confirmations rows (a real cron artifact, not seed data), and
    // even if it did, a "did you throw this away?" popup interrupting a
    // guided walkthrough would be a confusing, unrelated distraction.
    if (!restaurantId || tourActive) return;
    (async () => {
      const { data, error: confirmError } = await supabase
        .from("waste_confirmations")
        .select("id,ingredient_name,presumed_qty,presumed_value,last_seen_date")
        .eq("restaurant_id", restaurantId)
        .eq("status", "pending")
        .order("presumed_value", { ascending: false });
      if (confirmError) {
        console.error("Failed to fetch waste confirmations:", confirmError.message);
        return;
      }
      setPendingConfirmations(
        (data || []).map((r) => ({
          id: r.id,
          ingredientName: r.ingredient_name,
          presumedQty: r.presumed_qty,
          presumedValue: r.presumed_value,
          lastSeenDate: r.last_seen_date,
        }))
      );
    })();
  }, [restaurantId, reloadKey, tourActive]);

  async function handleWasteConfirmationRespond(id, status) {
    // The waste_confirmations table only grants authenticated users UPDATE
    // on the `status` column — confirmed_by/confirmed_at are force-set
    // server-side by a trigger regardless of what's sent here.
    const { error } = await supabase.from("waste_confirmations").update({ status }).eq("id", id);
    if (error) throw error;
  }

  const now = new Date();

  // Calendar cells + "top performer" are scoped to the browsed month
  // (viewDate), not always "now" — so navigating months actually changes
  // what's shown instead of just changing a label. Days outside the
  // browsed month are filtered out even though `weekData` may also contain
  // the trailing-7-day union (which can spill into an adjacent month).
  const week = useMemo(() => {
    const days = {};
    let top = null;
    (weekData || []).forEach((d) => {
      const dDate = new Date(d.date + "T12:00:00");
      if (dDate.getFullYear() !== viewDate.year || dDate.getMonth() !== viewDate.month) return;
      const day = dDate.getDate();
      const extra = d.extraSold != null ? d.extraSold : 0;
      days[day] = extra;
      (d.dishes || []).forEach((dish) => {
        if (dish.diff !== null && dish.diff !== undefined && (!top || dish.diff > top.delta)) {
          top = { name: dish.name || "—", date: d.dayLabel || "", delta: dish.diff };
        }
      });
    });
    const viewMonthDate = new Date(viewDate.year, viewDate.month, 1);
    return {
      month: MONTHS[viewDate.month] + " " + viewDate.year,
      viewYear: viewDate.year,
      viewMonth: viewDate.month,
      stats: [
        { label: "Extra sold", sub: "COVERS VS. AVG, LAST 7 NIGHTS", value: (weekExtraSold >= 0 ? "+" : "") + (weekExtraSold || 0), tone: "green" },
        { label: "Waste saved", sub: "ESTIMATED, LAST 7 NIGHTS", value: money(weekWasteSaved), tone: "green" },
        { label: "Hit rate", sub: "NIGHTS ABOVE AVERAGE", value: Math.round((hitRate || 0) * (hitRate <= 1 ? 100 : 1)) + "%", tone: "accent" },
      ],
      top: top ? { name: top.name, date: top.date, delta: (top.delta > 0 ? "+" : "") + top.delta } : { name: "—", date: "", delta: "0" },
      days,
      firstWeekdayIndex: firstWeekdayIndex(viewMonthDate),
      daysInMonth: new Date(viewDate.year, viewDate.month + 1, 0).getDate(),
      todayDay: isCurrentMonth ? now.getDate() : null,
    };
  }, [weekData, weekExtraSold, weekWasteSaved, hitRate, viewDate, isCurrentMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = data.stats;
  const stats = s
    ? [
        { label: "Avg margin", value: s.avgMargin.toFixed(1) + "%" },
        { label: "Low-margin items", value: String(s.lowMargin) },
        { label: "Expiring soon", value: String(s.expiring) },
        { label: "YTD spend", value: money(s.ytdSpend) },
      ]
    : [];

  // OptiScore — three outcome-based buckets, no weight on platform data
  // completeness (see chat). Bucket 3 (waste mitigation) ramps in from 0
  // weight during a restaurant's first 30 days to its full 25pt weight by
  // day 43 (+2 percentage points/day), since it needs real accumulated
  // waste_risk_snapshots/waste_confirmations history to mean anything.
  // Margin and adoption compress smoothly to fill the remaining weight,
  // keeping their 3:2 ratio the whole time — no sudden jump when the ramp
  // finishes.
  const optiScoreDetail = useMemo(() => {
    if (!s) return { value: 0, label: "Needs work" };

    // Margin target: restaurant's own target_food_cost when set, else 70%
    // margin (30% food cost) — matches the app-wide default elsewhere.
    const marginTarget = targetFoodCost != null ? Math.max(1, 100 - targetFoodCost) : 70;

    const createdAt = restaurantCreatedAt ? new Date(restaurantCreatedAt) : null;
    const daysSinceSignup = createdAt
      ? Math.floor((now - createdAt) / (1000 * 60 * 60 * 24))
      : 0;

    const wasteWeight = Math.min(25, Math.max(0, 2 * (daysSinceSignup - 30)));
    const remainingWeight = 100 - wasteWeight;
    const marginWeight = remainingWeight * 0.6;
    const adoptWeight = remainingWeight * 0.4;

    // Margin bucket — level : distribution kept at the old formula's 7:3 ratio.
    const marginLevelWeight = marginWeight * 0.7;
    const marginDistWeight = marginWeight * 0.3;
    const marginLevelScore = Math.min(1, s.avgMargin / marginTarget) * marginLevelWeight;
    // Distribution factor: 0.5 baseline, +/- up to 0.5 based on the mix of
    // high-margin (>=50%) vs. low-margin (<25%) items.
    const distFactor = Math.max(0, Math.min(1,
      0.5 + 0.5 * (s.pctAbove50 || 0) - 0.5 * (s.pctBelow25 || 0)
    ));
    const marginDistScore = distFactor * marginDistWeight;

    // Adoption bucket — hit rate primary (75%), extra-sold volume a capped
    // bonus (25%, maxing out at 10 extra covers/week — a guess pending real
    // calibration data).
    const volumeFactor = Math.min(1, Math.max(0, (weekExtraSold || 0) / 10));
    const adoptionScore = adoptWeight * (0.75 * ((hitRate || 0) / 100) + 0.25 * volumeFactor);

    // Waste-mitigation bucket. null resolutionRate (no at-risk activity to
    // measure yet) scores as full marks for this bucket — no waste problem
    // is a good outcome, not a scoring gap.
    const wasteRate = wasteResolution?.resolutionRate;
    const wasteScore = wasteWeight * (wasteRate != null ? wasteRate : 1);

    const value = Math.max(0, Math.min(100, Math.round(
      marginLevelScore + marginDistScore + adoptionScore + wasteScore
    )));

    return { value, label: value >= 85 ? "Strong" : value >= 65 ? "Good" : "Needs work" };
  }, [s, hitRate, weekExtraSold, wasteResolution, restaurantCreatedAt, targetFoodCost, now]);

  const firstName = (userName || "").split(" ")[0] || "there";
  const initials = (userName || "")
    .split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "•";

  return (
    <>
      <Head>
        <title>Dashboard · OptiMenu</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </Head>

      <PassDashboard
        loading={loading || weekLoading}
        error={error || null}
        onRetry={() => { setError(""); setReloadKey((k) => k + 1); }}
        activeNav="dashboard"
        NavLink={({ href, children, style, className }) => (
          <Link href={href} style={style} className={className}>{children}</Link>
        )}
        restaurantName={restaurantName}
        user={{ firstName, initials }}
        dateLabel={now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        timeLabel={now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        optiScore={{ value: optiScoreDetail.value, max: 100, label: optiScoreDetail.label }}
        stats={stats}
        tickets={toTickets(recommendations, data.wasteRisk, data.menuItems)}
        waste={toWaste(data.wasteRisk)}
        week={week}
        weekData={last7WeekData}
        monthWeekData={weekData}
        weekExtraSold={weekExtraSold}
        weekWasteSaved={weekWasteSaved}
        hitRate={hitRate}
        onPrevMonth={goToPrevMonth}
        onNextMonth={goToNextMonth}
        canGoNextMonth={!isCurrentMonth}
        tourActive={tourActive}
        onSearch={() => setSearchOpen(true)}
        onSignOut={async () => {
          await supabase.auth.signOut();
          router.push("/client/login");
        }}
      />

      {pendingConfirmations.length > 0 && (
        <WasteConfirmationModal
          items={pendingConfirmations}
          onRespond={handleWasteConfirmationRespond}
          onClose={() => setPendingConfirmations([])}
        />
      )}

      {tour.active && <TourOverlay tour={tour} />}

      <UniversalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}