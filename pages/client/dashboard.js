import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { computeWasteRisk } from "../../lib/computeWasteRisk"; // tour sample data only
import { loadCurrentInventory } from "../../lib/currentInventory";
import { computeWasteResolution } from "../../lib/computeWasteResolution";
import { useWeekInReview } from "../../lib/useWeekInReview";
import PassDashboard from "../../components/dashboard/PassDashboard";
import WasteConfirmationModal from "../../components/dashboard/WasteConfirmationModal";
import TourOverlay from "../../components/TourOverlay";
import { useTour } from "../../lib/useTour";
import { fetchSampleData, SAMPLE_AI_RECOMMENDATIONS } from "../../lib/seedSampleData";
import UniversalSearch from "../../components/UniversalSearch";
import useSWR from "swr";
import { useGuardedAccount } from "../../lib/useAccount";

const EMPTY_DASH = { ingredients: [], menuItems: [], wasteRisk: [], stats: null };
import { calculateStandardizedCost } from "../../lib/standardizedUnits";

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

/* Live plate cost using only prices the restaurant is allowed to see:
   invoice prices (is_estimated === false) or admin-approved estimates.
   Returns null if any ingredient is an unapproved AI guess, or the dish
   has no recipe rows. `trust` (tour sample data) uses the stored cost. */
function pricedCost(item, trust = false) {
  if (trust) return Number(item?.cost) > 0 ? Number(item.cost) : null;
  const lines = (item?.menu_item_components || []).flatMap((c) => c.component_ingredients || []);
  if (!lines.length) return null;
  let total = 0;
  for (const ci of lines) {
    const g = ci.ingredients || {};
    if (!(g.is_estimated === false || !!g.price_approved_at)) return null;
    const recipeUnit = ci.unit || g.unit || "each";
    total += calculateStandardizedCost(
      Number(ci.quantity) || 0, recipeUnit, Number(g.last_price) || 0, g.unit || recipeUnit, g.name || ""
    );
  }
  return total;
}

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
function toTickets(recs, wasteRisk, menuItems, trust = false) {
  const atRisk = new Set((wasteRisk || []).map((w) => String(w.name || "").toLowerCase().trim()));
  return (recs || []).slice(0, 3).map((r, i) => {
    // Ignore anything the AI appended in parentheses, e.g. "(South of the Border)".
    const key = (r.title || "").replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().trim();
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
    // Cost only from prices the restaurant may see (invoice or approved).
    // null hides both the $/cover and the margin chip. The AI's own
    // r.margin isn't used for real accounts — it came from unapproved
    // guesses. The tour's sample recs keep it.
    const cost = item ? pricedCost(item, trust) : null;
    const coverMargin = price > 0 && cost != null ? price - cost : null;
    const aiMargin = r.margin != null && !isNaN(parseFloat(r.margin)) ? parseFloat(r.margin) : null;
    const marginVal = price > 0 && cost != null ? ((price - cost) / price) * 100 : trust ? aiMargin : null;

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
    // Large amounts read better in bigger units: 5,700 oz is 356 lb.
    let n = Number(w.remainingQty), u = w.unit || "";
    if (u === "oz" && n >= 32) { n = n / 16; u = "lb"; }
    else if (u === "fl oz" && n >= 128) { n = n / 128; u = "gal"; }
    const qtyLabel = w.remainingQty != null
      ? (Math.round(n * 10) / 10).toLocaleString("en-US") + (u ? " " + u : "") + " remaining"
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [confirmationsDismissed, setConfirmationsDismissed] = useState(false);
  const [showTourPrompt, setShowTourPrompt] = useState(false);

  // Account (login, profile, restaurant) from the shared cache, with the
  // same account checks as enforceAccountGuard.
  const { account, loading: accountLoading, error: accountError } = useGuardedAccount();
  const restaurantId = account?.profile?.restaurant_id || null;
  const rd = account?.restaurant || null;
  const userName = account?.profile?.full_name || "";
  const restaurantName = rd?.name || "Your Restaurant";
  const restaurantCreatedAt = rd?.created_at || null;
  const targetFoodCost = rd?.target_food_cost != null ? Number(rd.target_food_cost) : null;

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.justOnboarded === "true") {
      setShowTourPrompt(true);
      router.replace("/client/dashboard", undefined, { shallow: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  // Computed fresh each render (not stored state) — re-evaluates whenever
  // this component re-renders, which happens reliably when the tour ends
  // (useTour's done() calls setTourOn(false) in this same component tree).
  // Included in effect dependency arrays below so those effects correctly
  // re-fetch real data once the tour finishes, rather than sample data
  // silently lingering for the rest of the session.
  const tourActive = isTourQueryActive();

  // Days up to and including signup have no real sales history for this
  // restaurant. Not applied during the tour, which borrows the sample
  // restaurant's history.
  const signupDay = !tourActive && restaurantCreatedAt
    ? new Date(restaurantCreatedAt).toLocaleDateString("en-CA")
    : null;

  /* ── data ── kept in the shared cache: a return visit shows the last copy
     at once while a fresh one loads in the background. ── */
  const { data: dashData, error: dashError, mutate: reloadDash } = useSWR(
    restaurantId ? ["dashboard", restaurantId, tourActive] : null,
    async () => {
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
            .filter((iv) => String(iv.date || "").slice(0, 4) === String(new Date().getFullYear()))
            .reduce((s, iv) => s + (Number(iv.amount) || 0), 0);
          return {
            ingredients: sample.ingredients || [],
            menuItems: sample.menuItems || [],
            wasteRisk,
            stats: {
              avgMargin: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0,
              lowMargin: margins.filter((m) => m < 50).length,
              expiring: wasteRisk.filter((w) => w.daysLeft <= 3).length,
              ytdSpend,
              pctAbove50,
              pctBelow25,
              pricedCount: margins.length,
            },
          };
        }
        // fetchSampleData() failed: fall through to the real data below
        // rather than leave the tour blank.
      }

      // Waste risk comes from current_inventory, the same rows Tonight's Dish
      // reads, rebuilt overnight and whenever an invoice is saved or linked.
      const [{ data: invoices }, { data: ingredients }, { data: menuItems }, wasteRisk] =
        await Promise.all([
          supabase.from("invoices").select("*").eq("restaurant_id", restaurantId).order("date", { ascending: false }),
          supabase.from("ingredients").select("*").eq("restaurant_id", restaurantId).limit(1000),
          supabase.from("menu_items")
            .select("id,name,price,cost,category,menu_item_components(id,name,cost,component_ingredients(quantity,unit,ingredients(id,name,unit,last_price,is_estimated,price_approved_at)))")
            .eq("restaurant_id", restaurantId).is("archived_at", null).limit(500),
          loadCurrentInventory(supabase, restaurantId),
        ]);
      // Only dishes whose every ingredient has an invoice or approved price.
      const margins = (menuItems || [])
        .map((m) => ({ price: Number(m.price) || 0, cost: pricedCost(m) }))
        .filter((m) => m.price > 0 && m.cost != null)
        .map((m) => ((m.price - m.cost) / m.price) * 100);
      const pctAbove50 = margins.length ? margins.filter((m) => m >= 50).length / margins.length : 0;
      const pctBelow25 = margins.length ? margins.filter((m) => m < 25).length / margins.length : 0;
      const ytdSpend = (invoices || [])
        .filter((iv) => String(iv.date || "").slice(0, 4) === String(new Date().getFullYear()))
        .reduce((s, iv) => s + (Number(iv.amount) || 0), 0);

      return {
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
          pricedCount: margins.length,
        },
      };
    }
  );
  const data = dashData || EMPTY_DASH;
  const noRestaurant = !!account && !restaurantId;
  const loading = accountLoading || (!!restaurantId && !dashData && !dashError);
  const error =
    accountError ||
    (noRestaurant ? "Could not determine restaurant access" : "") ||
    (dashError ? "Failed to fetch dashboard data: " + dashError.message : "");

  // Which month the desktop calendar is currently browsing. Defaults to the
  // current month; useWeekInReview always fetches the trailing 7 days too
  // (for the "last 7 nights" summary stats), so browsing history doesn't
  // lose that regardless of what month is in view.
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const isCurrentMonth = viewDate.year === new Date().getFullYear() && viewDate.month === new Date().getMonth();
  const monthRangeFrom = new Date(viewDate.year, viewDate.month, 1).toLocaleDateString("en-CA");
  const monthRangeTo = new Date(viewDate.year, viewDate.month + 1, 0).toLocaleDateString("en-CA");

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
    const start = cutoff.toLocaleDateString("en-CA"); // local date, so evenings don't drop the oldest night
    return (weekData || [])
      .filter((d) => d.date >= start)
      .map((d) => (signupDay && d.date <= signupDay ? { ...d, extraSold: null } : d));
  }, [weekData, signupDay]);

  /* ── tonight's recommendations ── kept between visits; rechecked at most
     every 5 minutes ── */
  const mapRec = (r) => ({
    title: r.title,
    description: r.description,
    talkingPoint: r.talking_point || null,
    type: r.type || null,
    margin: r.margin || null,
    confidence: r.confidence || null,
    urgency: r.urgency || null,
  });
  const { data: recData, error: recError, mutate: reloadRecs } = useSWR(
    restaurantId ? ["recs", restaurantId, tourActive] : null,
    async () => {
      // The tour uses hardcoded sample recs so it never waits on (or pays
      // for) a real Claude call.
      if (tourActive) return SAMPLE_AI_RECOMMENDATIONS.map(mapRec);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/ai-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ restaurantId }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error); // the route reports failures inside a 200 response
      return (json.recommendations || []).map(mapRec);
    },
    { dedupingInterval: 300000 }
  );
  const recommendations = recData || [];
  const recsStatus = recError ? "error" : recData ? "ready" : "loading";

  /* ── waste resolution (OptiScore input) ── */
  const { data: wasteResolution, mutate: reloadResolution } = useSWR(
    restaurantId ? ["waste-resolution", restaurantId] : null,
    async () => {
      try {
        return await computeWasteResolution(supabase, restaurantId, 30);
      } catch (err) {
        console.error("Failed to compute waste resolution:", err);
        return { resolvedViaRecommendation: 0, wasted: 0, resolutionRate: null };
      }
    }
  );

  /* ── pending "did you throw this away?" prompts ── not during a tour: the
     sample restaurant has none, and a popup would interrupt the walkthrough ── */
  const { data: confirmationRows, mutate: reloadConfirmations } = useSWR(
    restaurantId && !tourActive ? ["waste-confirmations", restaurantId] : null,
    async () => {
      const { data: rows, error: confirmError } = await supabase
        .from("waste_confirmations")
        .select("id,ingredient_name,presumed_qty,presumed_value,last_seen_date,invoice_items(unit,ingredients(unit))")
        .eq("restaurant_id", restaurantId)
        .eq("status", "pending")
        .order("presumed_value", { ascending: false });
      if (confirmError) throw confirmError;
      return (rows || []).map((r) => ({
        id: r.id,
        ingredientName: r.ingredient_name,
        presumedQty: r.presumed_qty,
        presumedValue: r.presumed_value,
        lastSeenDate: r.last_seen_date,
        // presumed_qty is in the linked ingredient's unit when there is one
        unit: r.invoice_items?.ingredients?.unit || r.invoice_items?.unit || "",
      }));
    }
  );
  const pendingConfirmations = confirmationsDismissed ? [] : confirmationRows || [];

  async function handleWasteConfirmationRespond(id, status) {
    // The waste_confirmations table only grants authenticated users UPDATE
    // on the `status` column — confirmed_by/confirmed_at are force-set
    // server-side by a trigger regardless of what's sent here.
    const { error } = await supabase.from("waste_confirmations").update({ status }).eq("id", id);
    if (error) throw error;
    reloadConfirmations();
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
      days[day] = d.extraSold; // null = no sales for that night yet, shown as a dash
      (d.dishes || []).forEach((dish) => {
        if (dish.diff !== null && dish.diff !== undefined && (!top || dish.diff > top.delta)) {
          top = { name: dish.name || "—", date: d.dayLabel || "", delta: dish.diff };
        }
      });
    });
    if (signupDay) {
      const dim = new Date(viewDate.year, viewDate.month + 1, 0).getDate();
      for (let dd = 1; dd <= dim; dd++) {
        const iso = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
        if (iso <= signupDay) days[dd] = null;
      }
    }
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
      top: top ? { name: top.name, date: top.date, delta: (top.delta > 0 ? "+" : "") + (Math.round(top.delta * 10) / 10) } : { name: "—", date: "", delta: "0" },
      days,
      firstWeekdayIndex: firstWeekdayIndex(viewMonthDate),
      daysInMonth: new Date(viewDate.year, viewDate.month + 1, 0).getDate(),
      todayDay: isCurrentMonth ? now.getDate() : null,
    };
  }, [weekData, weekExtraSold, weekWasteSaved, hitRate, viewDate, isCurrentMonth, signupDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = data.stats;
  const stats = s
    ? [
        { label: "Avg margin", value: s.pricedCount ? s.avgMargin.toFixed(1) + "%" : "—" },
        { label: "Low-margin items", value: s.pricedCount ? String(s.lowMargin) : "—" },
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
    // No fully priced dishes yet — a margin score would be meaningless.
    if (!s.pricedCount) return { value: null, label: "Awaiting pricing" };

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
        loading={loading}
        error={error || null}
        onRetry={() => { reloadDash(); reloadRecs(); reloadResolution(); }}
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
        tickets={toTickets(recommendations, data.wasteRisk, data.menuItems, tourActive)}
        ticketsStatus={recsStatus}
        onRetryTickets={() => reloadRecs()}
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
          onClose={() => setConfirmationsDismissed(true)}
        />
      )}

      {tour.active && <TourOverlay tour={tour} />}

      {showTourPrompt && (
        <div style={{ position: "fixed", inset: 0, zIndex: 700, background: "rgba(17,24,25,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "100%", maxWidth: 420, background: "#fff", border: "1px solid #d8dfe0", borderRadius: 14, boxShadow: "0 24px 60px rgba(17,24,25,0.25)", padding: 28, fontFamily: "'Manrope',sans-serif", textAlign: "center" }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#111819", marginBottom: 10 }}>Want a quick tour?</div>
            <div style={{ fontSize: 13.5, color: "#4b585b", lineHeight: 1.6, marginBottom: 24 }}>
              Two minutes to see how a fully set-up OptiMenu account works, using sample data — nothing here touches your real numbers.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={() => { localStorage.setItem("optimenu_tour_done", "1"); setShowTourPrompt(false); }} style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "1px solid #d8dfe0", background: "none", color: "#111819", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>No thanks</button>
              <button type="button" onClick={() => router.push("/client/dashboard?tour=true")} style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "none", background: "#02a4ba", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Yes, show me</button>
            </div>
          </div>
        </div>
      )}

      <UniversalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}