// pages/client/dashboard.js
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import UniversalSearch from "../../components/UniversalSearch";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  BarChart,
  Bar,
  Area,
  AreaChart,
  Cell,
} from "recharts";
import {
  IconDashboard,
  IconFileText,
  IconChartBar,
  IconTrendingUp,
  IconAlertTriangle,
  IconCurrencyDollar,
  IconChefHat,
  IconArrowRight,
  IconClipboardList,
  IconBrain,
  IconStar,
  IconActivity,
  IconSparkles,
  IconTrendingDown,
} from '@tabler/icons-react';
import ClientLayout from '../../components/ClientLayout';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

// Add this style component
const GeometricBackground = ({ children }) => (
  <>
    <style jsx>{`
      .geometric-pattern {
        background-image: 
          radial-gradient(circle at 25px 25px, rgba(59, 130, 246, 0.05) 2px, transparent 2px),
          radial-gradient(circle at 75px 75px, rgba(59, 130, 246, 0.03) 1px, transparent 1px);
        background-size: 100px 100px, 50px 50px;
        background-position: 0 0, 25px 25px;
      }
    `}</style>
    <div className="geometric-pattern min-h-screen">
      {children}
    </div>
  </>
);

// Add this style component after GeometricBackground
const ChartStyles = () => (
  <style jsx global>{`
    .recharts-responsive-container,
    .recharts-responsive-container:focus,
    .recharts-wrapper,
    .recharts-wrapper:focus,
    .recharts-surface,
    .recharts-surface:focus,
    .recharts-cartesian-grid,
    .recharts-cartesian-grid:focus,
    .recharts-bar,
    .recharts-bar:focus,
    .recharts-rectangle,
    .recharts-rectangle:focus,
    svg,
    svg:focus {
      outline: none !important;
      border: none !important;
    }
    
    /* Remove focus outlines from all SVG elements */
    svg * {
      outline: none !important;
    }
    
    /* Specifically target the chart container */
    .recharts-responsive-container > div {
      outline: none !important;
    }
    
    /* Remove any focus states */
    *:focus {
      outline: none !important;
    }
  `}</style>
);

export default function ClientDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restaurantId, setRestaurantId] = useState(null);
  const [marginView, setMarginView] = useState("Highest-Margin"); // "Highest-Margin" or "Lowest-Margin"
  const [aiLoading, setAiLoading] = useState(false); // New state for AI Loading
  const [dashboardData, setDashboardData] = useState({
    totalInvoices: 0,
    totalIngredients: 0,
    totalMenuItems: 0,
    lowMarginItems: [],
    recentInvoices: [],
    ingredientTrends: [],
    menuItemAnalysis: [],
    monthlySpending: [],
    unpricedIngredients: 0,
    averageMargin: 0,
    totalSpending: 0,
    aiProfitScore: { score: 0, breakdown: {} },
    processingStats: { processed: 0, pending: 0 }
  });
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [dailySpending, setDailySpending] = useState([]);
  const [restaurantName, setRestaurantName] = useState("");

  // Alert thresholds
  const LOW_MARGIN_THRESHOLD = 40;
  const VERY_LOW_MARGIN_THRESHOLD = 25;

  useEffect(() => {
    getRestaurantId();
  }, []);

  useEffect(() => {
    if (restaurantId) {
      fetchDashboardData();
    }
  }, [restaurantId]);

  async function getRestaurantId() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError || !user) {
        setError("Authentication required");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("restaurant_id, full_name")
        .eq("id", user.id)
        .single();

      if (error || !data?.restaurant_id) {
        setError("Could not determine restaurant access");
        setLoading(false);
        return;
      }

      setRestaurantId(data.restaurant_id);
      const firstName = data.full_name ? data.full_name.split(' ')[0] : "User";
      setUserName(firstName);

      // Fetch restaurant name
      const { data: restaurantData } = await supabase
        .from("restaurants")
        .select("name")
        .eq("id", data.restaurant_id)
        .single();

      setRestaurantName(restaurantData?.name || "Your Restaurant");
    } catch (err) {
      setError("An unexpected error occurred");
      setLoading(false);
    }
  }

  async function fetchDashboardData() {
    try {
      setLoading(true);
      setError("");

      // Fetch invoices
      const { data: invoices, error: invoicesError } = await supabase
        .from("invoices")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false });

      if (invoicesError) throw invoicesError;

      // Fetch ingredients
      const { data: ingredients, error: ingredientsError } = await supabase
        .from("ingredients")
        .select("*")
        .eq("restaurant_id", restaurantId);

      if (ingredientsError) throw ingredientsError;

      // Fetch menu items with ingredients
      const { data: menuItems, error: menuItemsError } = await supabase
        .from("menu_items")
        .select(`
          *,
          menu_item_components (
            id,
            name,
            cost,
            component_ingredients (
              quantity,
              ingredients (
                last_price
              )
            )
          )
        `)
        .eq("restaurant_id", restaurantId);

      if (menuItemsError) throw menuItemsError;

      // Process data (keep this synchronous)
      const processedData = processDashboardData(invoices, ingredients, menuItems);
      
      // Set dashboard data immediately (without AI recommendations)
      setDashboardData(processedData);
      setLoading(false); // Dashboard is now loaded and ready to display
      
      // Fetch AI recommendations separately in the background
      fetchAIRecommendationsAsync(processedData);

    } catch (err) {
      setError("Failed to fetch dashboard data: " + err.message);
      setLoading(false);
    }
  }

  // Add this function in your dashboard component
  async function fetchAIRecommendationsAsync(dashboardData) {
    try {
      setAiLoading(true);
      
      const requestBody = {
        dashboardData,
        restaurantId,
        restaurantName: userName
      };
      
      const response = await fetch('/api/ai-recommendations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      
      // Update only the AI recommendations in the existing dashboard data
      setDashboardData(prevData => ({
        ...prevData,
        aiRecommendations: data.recommendations
      }));
      
    } catch (error) {
      console.error('AI recommendations error:', error);
      
      // Set fallback recommendations on error
      setDashboardData(prevData => ({
        ...prevData,
        aiRecommendations: [
          {
            title: "Check High Margins",
            description: "Review top performing items",
            type: "promote",
            color: "green"
          },
          {
            title: "Monitor Costs", 
            description: "Track ingredient pricing",
            type: "alert",
            color: "orange"
          },
          {
            title: "Optimize Menu",
            description: "Update low margin items", 
            type: "optimize",
            color: "red"
          }
        ]
      }));
    } finally {
      setAiLoading(false);
    }
  }


  function processDashboardData(invoices, ingredients, menuItems) {
    const totalInvoices = invoices.length;
    const totalIngredients = ingredients.length;
    const totalMenuItems = menuItems.length;

    const processedInvoices = invoices.filter(inv => inv.number && inv.supplier && inv.amount);
    const pendingInvoices = invoices.filter(inv => !inv.number || !inv.supplier || !inv.amount);
    const totalSpending = processedInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);
    const unpricedIngredients = ingredients.filter(ing => !ing.last_price || parseFloat(ing.last_price) === 0).length;

    const recentInvoices = processedInvoices.slice(0, 3).map(inv => ({
      id: inv.id, number: inv.number, supplier: inv.supplier, amount: inv.amount, date: inv.date, created_at: inv.created_at
    }));

    const menuItemAnalysis = menuItems.map(item => {
      const totalCost = calculateMenuItemCost(item);
      const price = parseFloat(item.price || 0);
      const margin = price > 0 ? ((price - totalCost) / price) * 100 : 0;
      return { id: item.id, name: item.name, price, cost: totalCost, margin, hasCompleteData: hasCompleteIngredientData(item) };
    });

    const lowMarginItems = menuItemAnalysis
      .filter(item => item.hasCompleteData && item.price > 0 && item.margin < LOW_MARGIN_THRESHOLD)
      .sort((a, b) => a.margin - b.margin);

    const itemsWithMargins = menuItemAnalysis.filter(item => item.hasCompleteData && item.price > 0);
    const averageMargin = itemsWithMargins.length > 0 ? itemsWithMargins.reduce((sum, item) => sum + item.margin, 0) / itemsWithMargins.length : 0;

    const monthlySpending = calculateMonthlySpending(processedInvoices);

    const ingredientTrends = ingredients
      .filter(ing => ing.last_price > 0)
      .sort((a, b) => parseFloat(b.last_price) - parseFloat(a.last_price))
      .slice(0, 3)
      .map(ing => ({
        name: ing.name.length > 15 ? ing.name.substring(0, 15) + '...' : ing.name,
        fullName: ing.name,
        price: parseFloat(ing.last_price),
        unit: ing.unit
      }));

      // Calculate AI Profit Score
      const aiProfitScore = calculateAIProfitScore({
        menuItemAnalysis,
        itemsWithMargins,
        averageMargin,
        unpricedIngredients,
        totalIngredients,
        totalMenuItems,
        processedInvoices,
        totalInvoices
      });

      return {
        totalInvoices, totalIngredients, totalMenuItems, lowMarginItems, recentInvoices,
        ingredientTrends, menuItemAnalysis, monthlySpending, unpricedIngredients,
        averageMargin, totalSpending, aiProfitScore,
        processingStats: { processed: processedInvoices.length, pending: pendingInvoices.length }
      };
      
      // Remove the duplicate return statement below
    }

  // NEW (corrected):
  function calculateMenuItemCost(menuItem) {
    if (!menuItem.menu_item_components || menuItem.menu_item_components.length === 0) return 0;
    
    return menuItem.menu_item_components.reduce((total, component) => {
      // Use the component's cost directly if available
      const componentCost = parseFloat(component.cost || 0);
      return total + componentCost;
    }, 0);
  }

  function hasCompleteIngredientData(menuItem) {
    if (!menuItem.menu_item_components || menuItem.menu_item_components.length === 0) return false;
    
    return menuItem.menu_item_components.every(component => {
      if (!component.component_ingredients || component.component_ingredients.length === 0) return false;
      
      return component.component_ingredients.every(ingredient => 
        ingredient.ingredients?.last_price && parseFloat(ingredient.ingredients.last_price) > 0
      );
    });
  }

  function calculateMonthlySpending(invoices) {
    const currentYear = new Date().getFullYear();
    const monthlyTotals = {};
    
    // Initialize all months of current year with zero
    for (let month = 1; month <= 12; month++) {
      const monthKey = `${currentYear}-${String(month).padStart(2, '0')}`;
      const monthName = new Date(currentYear, month - 1).toLocaleDateString('en-US', { month: 'short' });
      monthlyTotals[monthKey] = { month: monthName, total: 0, invoiceCount: 0, monthNumber: month };
    }
    
    // Add actual invoice data
    invoices.forEach(invoice => {
      if (invoice.date && invoice.amount) {
        const date = new Date(invoice.date);
        if (date.getFullYear() === currentYear) {
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          if (monthlyTotals[monthKey]) {
            monthlyTotals[monthKey].total += parseFloat(invoice.amount);
            monthlyTotals[monthKey].invoiceCount += 1;
          }
        }
      }
    });

    return Object.values(monthlyTotals).sort((a, b) => a.monthNumber - b.monthNumber);
  }

  function calculateDailySpending(invoices, year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyTotals = {};
    
    // Initialize all days of the month with zero
    for (let day = 1; day <= daysInMonth; day++) {
      const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      dailyTotals[dayKey] = { 
        day: day, 
        dayName: new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'short' }),
        total: 0, 
        invoiceCount: 0 
      };
    }
    
    // Add actual invoice data for the specific month
    invoices.forEach(invoice => {
      if (invoice.date && invoice.amount) {
        const date = new Date(invoice.date);
        if (date.getFullYear() === year && date.getMonth() + 1 === month) {
          const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          if (dailyTotals[dayKey]) {
            dailyTotals[dayKey].total += parseFloat(invoice.amount);
            dailyTotals[dayKey].invoiceCount += 1;
          }
        }
      }
    });

    return Object.values(dailyTotals).sort((a, b) => a.day - b.day);
  }

  function handleMonthClick(data, index) {
    if (data && data.monthNumber) {
      const currentYear = new Date().getFullYear();
      const monthNumber = data.monthNumber;
      
      setSelectedMonth({ year: currentYear, month: monthNumber, name: data.month });
      
      // Fetch all invoices for the selected month
      fetchAllInvoicesForMonth(currentYear, monthNumber);
    }
  }

  async function fetchAllInvoicesForMonth(year, month) {
    try {
      // Create start and end dates for the month
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = month === 12 
        ? `${year + 1}-01-01` 
        : `${year}-${String(month + 1).padStart(2, '0')}-01`;

      const { data: allInvoices, error } = await supabase
        .from("invoices")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .gte('date', startDate)
        .lt('date', endDate);

      if (error) throw error;

      const dailyData = calculateDailySpending(allInvoices || [], year, month);
      setDailySpending(dailyData);
    } catch (error) {
      console.error('Error fetching monthly invoices:', error);
      // Fallback to empty data
      setDailySpending([]);
    }
  }

  function handleBackToMonthly() {
    setSelectedMonth(null);
    setDailySpending([]);
  }

  function formatCurrency(amount) {
    if (!amount) return "$0";
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return "$0";
    return numAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function formatCurrencyDetailed(amount) {
    if (!amount) return "$0.00";
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return "$0.00";
    return numAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(dateString) {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return "N/A";
    }
  }

  function getMarginColor(margin) {
    if (margin >= 60) return "#10b981";
    if (margin >= 40) return "#3b82f6"; 
    if (margin >= 25) return "#f59e0b";
    return "#ef4444";
  }

  // AI Profit Score calculation function
  function calculateAIProfitScore(data) {
    const {
      menuItemAnalysis,
      itemsWithMargins,
      averageMargin,
      unpricedIngredients,
      totalIngredients,
      totalMenuItems,
      processedInvoices,
      totalInvoices
    } = data;

    let score = 0;

    // 1. Average Margin Score (30 points max)
    const marginScore = Math.min((averageMargin / 60) * 30, 30);
    score += marginScore;

    // 2. Data Completeness Score (25 points max)
    const dataCompletenessFactors = [
      totalIngredients > 0 ? ((totalIngredients - unpricedIngredients) / totalIngredients) * 10 : 0,
      totalMenuItems > 0 ? (itemsWithMargins.length / totalMenuItems) * 10 : 0,
      totalInvoices > 0 ? (processedInvoices.length / totalInvoices) * 5 : 0
    ];
    const dataScore = dataCompletenessFactors.reduce((sum, factor) => sum + factor, 0);
    score += dataScore;

    // 3. Margin Distribution Score (20 points max)
    if (itemsWithMargins.length > 0) {
      const highMarginItems = itemsWithMargins.filter(item => item.margin >= 50).length;
      const lowMarginItems = itemsWithMargins.filter(item => item.margin < 25).length;
      
      const distributionScore = Math.min(
        ((highMarginItems / itemsWithMargins.length) * 15) - 
        ((lowMarginItems / itemsWithMargins.length) * 10) + 10, 
        20
      );
      score += Math.max(distributionScore, 0);
    }

    // 4. Operational Efficiency Score (15 points max)
    const recentInvoiceCount = processedInvoices.filter(inv => {
      const invoiceDate = new Date(inv.created_at);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return invoiceDate >= thirtyDaysAgo;
    }).length;

    const efficiencyScore = Math.min((recentInvoiceCount / 10) * 15, 15);
    score += efficiencyScore;

    // 5. Cost Control Score (10 points max)
    if (itemsWithMargins.length > 0) {
      const costVariance = itemsWithMargins.reduce((sum, item) => {
        const targetMargin = 45;
        const variance = Math.abs(item.margin - targetMargin);
        return sum + variance;
      }, 0) / itemsWithMargins.length;

      const costControlScore = Math.max(10 - (costVariance / 5), 0);
      score += costControlScore;
    }

    const finalScore = Math.max(0, Math.min(100, Math.round(score)));
    
    return {
      score: finalScore,
      breakdown: {
        marginScore: Math.round(marginScore),
        dataScore: Math.round(dataScore),
        distributionScore: Math.round(score - marginScore - dataScore - efficiencyScore),
        efficiencyScore: Math.round(efficiencyScore),
        costControlScore: Math.round(score - marginScore - dataScore - efficiencyScore)
      }
    };
  }

  // Function to get score color and label
  function getScoreColor(score) {
    if (score >= 85) return { color: "#10b981", label: "Excellent" };
    if (score >= 70) return { color: "#3b82f6", label: "Good" };
    if (score >= 55) return { color: "#f59e0b", label: "Fair" };
    return { color: "#ef4444", label: "Needs Improvement" };
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Loading Dashboard</h3>
          <p className="text-gray-600">Analyzing your restaurant data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">⚠️</div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Unable to Load Dashboard</h3>
          <p className="text-gray-600 mb-6">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const getMarginItems = () => {
    const itemsWithMargins = dashboardData.menuItemAnalysis.filter(item => 
      item.hasCompleteData && item.price > 0
    );

    if (itemsWithMargins.length === 0) return [];

    const sortedItems = itemsWithMargins.sort((a, b) => b.margin - a.margin);
    
    if (marginView === "Highest-Margin") {
      return sortedItems.slice(0, 3);
    } else {
      return sortedItems.slice(-3).reverse();
    }
  };

  const getUserInitials = (name) => {
    if (!name) return "U";
    return name.split(' ')
      .map(part => part.charAt(0))
      .join('')
      .substring(0, 2)
      .toUpperCase();
  };

  return (
    <GeometricBackground>
      <ChartStyles />
      <ClientLayout>
        {/* Header with Welcome Message, Search Bar, and Profile */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between mb-4 gap-3">
          <h1 className="text-xl font-bold text-gray-900">Welcome Back, {userName}!</h1>
          <div className="flex items-center gap-3">
            <div className="w-full xl:w-80">
              <UniversalSearch 
                restaurantId={restaurantId}
                placeholder="Search invoices, ingredients, menu items..."
              />
            </div>
            <div className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full font-semibold text-xs cursor-pointer hover:bg-blue-700 transition-colors flex-shrink-0">
              {getUserInitials(userName)}
            </div>
          </div>
        </div>

        {/* Dashboard Layout - New Grid Structure */}
        <div className="grid grid-cols-12 gap-3 h-[75vh]">
          
          {/* Left Column - AI Profit Score */}
          <div className="col-span-2 row-span-2">
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 h-[262px] flex flex-col">
              <div className="text-center flex-shrink-0">
                <div className="flex items-center justify-center gap-1.5 mb-1.5">
                  <IconBrain size={14} className="text-blue-600" />
                  <h3 className="text-xs font-semibold text-gray-900">AI Profit Score</h3>
                </div>
                <p className="text-[10px] text-gray-500 mb-2">Daily optimization rating</p>
              </div>
              <div className="flex-1 flex items-center justify-center min-h-0">
                <div className="relative w-24 h-24 lg:w-28 lg:h-28">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
                    <circle
                      cx="100"
                      cy="100"
                      r="85"
                      stroke="#e5e7eb"
                      strokeWidth="10"
                      fill="transparent"
                    />
                    <circle
                      cx="100"
                      cy="100"
                      r="85"
                      stroke={getScoreColor(dashboardData.aiProfitScore.score).color}
                      strokeWidth="10"
                      fill="transparent"
                      strokeDasharray={`${(dashboardData.aiProfitScore.score / 100) * (2 * Math.PI * 85)} ${2 * Math.PI * 85}`}
                      strokeLinecap="round"
                      className="transition-all duration-1000 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-2xl lg:text-3xl font-bold text-gray-900">{dashboardData.aiProfitScore.score}</div>
                      <div className="text-xs text-gray-500">Score</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="text-center flex-shrink-0">
                <div className="text-[10px] text-gray-600 mb-1.5 px-1">
                  Based on margin analysis and pricing optimization
                </div>
                <div 
                  className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                  style={{ 
                    backgroundColor: getScoreColor(dashboardData.aiProfitScore.score).color + '20',
                    color: getScoreColor(dashboardData.aiProfitScore.score).color
                  }}
                >
                  {getScoreColor(dashboardData.aiProfitScore.score).label}
                </div>
              </div>
            </div>
          </div>

          {/* Welcome Message - Top Row */}
          <div className="col-span-10">
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 h-[50px] flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">Welcome back, {userName}!</h1>
            </div>
          </div>

          {/* Top Right Grid - 3 smaller cards */}
          <div className="col-span-10 grid grid-cols-7 gap-3">
            
            {/* Recent Invoices */}
            <div className="col-span-3 bg-white rounded-lg border border-gray-200 shadow-sm p-3 h-[200px]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-900">Recent Invoices</h3>
                <button 
                  onClick={() => router.push('/client/invoices')}
                  className="text-blue-600 hover:text-blue-700 text-[10px] font-medium"
                >
                  View All
                </button>
              </div>
              <div className="flex flex-col gap-2" style={{ height: 'calc(100% - 25px)' }}>
                {dashboardData.recentInvoices.slice(0, 3).map(invoice => (
                  <div key={invoice.id} className="flex items-center justify-between p-1.5 bg-gray-50 rounded-md" style={{ height: 'calc(33.33% - 4px)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-xs truncate">{invoice.number}</p>
                      <p className="text-[10px] text-gray-500 truncate">{invoice.supplier}</p>
                    </div>
                    <div className="text-right ml-2">
                      <p className="font-semibold text-gray-900 text-xs">{formatCurrency(invoice.amount)}</p>
                      <p className="text-[10px] text-gray-500">{formatDate(invoice.date)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Highest Ingredient Costs */}
            <div className="col-span-3 bg-white rounded-lg border border-gray-200 shadow-sm p-3 h-[200px]">
              <h3 className="text-xs font-semibold text-gray-900 mb-2">Highest Ingredient Costs</h3>
              <div className="flex flex-col gap-2" style={{ height: 'calc(100% - 25px)' }}>
                {dashboardData.ingredientTrends.map((ingredient, index) => (
                  <div key={index} className="flex items-center justify-between p-1.5 bg-gray-50 rounded-md" style={{ height: 'calc(33.33% - 4px)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-xs truncate">{ingredient.fullName}</p>
                      <p className="text-[10px] text-gray-500">per {ingredient.unit}</p>
                    </div>
                    <div className="text-right ml-2">
                      <p className="font-semibold text-gray-900 text-xs">{formatCurrencyDetailed(ingredient.price)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Your Restaurant Data - Enhanced */}
            <div className="col-span-1 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border border-blue-200 shadow-sm p-3 h-[200px] flex flex-col justify-center items-center relative overflow-hidden">
              
              {/* Main content */}
              <div className="text-center relative z-10">
                <div className="flex items-center justify-center w-12 h-12 bg-blue-600 rounded-full mb-3 mx-auto">
                  <IconChefHat size={20} className="text-white" />
                </div>
                <h3 className="text-xs font-semibold text-blue-800 mb-1">Your Restaurant</h3>
                <h2 className="text-sm font-bold text-gray-900 mb-1 leading-tight">{restaurantName}</h2>
                <p className="text-[10px] text-gray-600 leading-tight">Management Dashboard</p>
                
                {/* Status indicator */}
                <div className="flex items-center justify-center gap-1 mt-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-[10px] text-gray-600">Active</span>
                </div>
              </div>
            </div>
          </div>

          {/* Middle Row - AI Recommendations */}
          <div className="col-span-5">
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 h-[320px] flex flex-col">
              <div className="flex items-center gap-2 mb-2 flex-shrink-0">
                <div className="flex items-center justify-center w-6 h-6 bg-blue-100 rounded-lg">
                  <IconSparkles size={14} className="text-blue-600" />
                </div>
                <h3 className="text-xs font-semibold text-gray-900">AI Daily Dish Recommendations</h3>
                {aiLoading && (
                  <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                )}
              </div>
              
              <div className="flex flex-col flex-1 min-h-0 gap-2" style={{ height: 'calc(100% - 40px)' }}>
                {aiLoading ? (
                  // Loading state
                  <>
                    <div className="bg-blue-50 rounded-md p-3 border-l-4 border-blue-500 animate-pulse" style={{ height: 'calc(33.33% - 4px)' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                        <div className="h-4 bg-blue-200 rounded w-3/4"></div>
                      </div>
                      <div className="h-3 bg-blue-200 rounded w-full"></div>
                    </div>
                    <div className="bg-blue-50 rounded-md p-3 border-l-4 border-blue-500 animate-pulse" style={{ height: 'calc(33.33% - 4px)' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                        <div className="h-4 bg-blue-200 rounded w-2/3"></div>
                      </div>
                      <div className="h-3 bg-blue-200 rounded w-full"></div>
                    </div>
                    <div className="bg-blue-50 rounded-md p-3 border-l-4 border-blue-500 animate-pulse" style={{ height: 'calc(33.33% - 4px)' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                        <div className="h-4 bg-blue-200 rounded w-4/5"></div>
                      </div>
                      <div className="h-3 bg-blue-200 rounded w-full"></div>
                    </div>
                  </>
                ) : dashboardData.aiRecommendations && dashboardData.aiRecommendations.length > 0 ? (
                  // Loaded recommendations
                  dashboardData.aiRecommendations.map((rec, index) => (
                    <div 
                      key={index}
                      className="rounded-md p-3 border-l-4 border-blue-500 bg-blue-50 flex flex-col justify-center"
                      style={{ height: 'calc(33.33% - 4px)' }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <span className="font-semibold text-gray-900 text-sm">{rec.title}</span>
                      </div>
                      <p className="text-xs text-gray-600">{rec.description}</p>
                    </div>
                  ))
                ) : (
                  // Empty state (no recommendations loaded yet)
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                    <IconSparkles size={24} className="mb-2 text-gray-400" />
                    <p className="text-xs">Preparing recommendations...</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Monthly Spending Chart */}
          <div className="col-span-7">
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 h-[320px] flex flex-col">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <div className="flex items-center gap-2">
                  {selectedMonth && (
                    <button
                      onClick={handleBackToMonthly}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                    >
                      ← Back
                    </button>
                  )}
                  <h3 className="text-xs font-semibold text-gray-900">
                    {selectedMonth ? `Daily Spending - ${selectedMonth.name}` : 'Monthly Spending Chart'}
                  </h3>
                </div>
                {!selectedMonth && (
                  <button 
                    onClick={() => router.push('/client/invoices')}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                  >
                    View All <IconArrowRight size={14} />
                  </button>
                )}
              </div>
              <div className="flex-1 min-h-0 w-full">
                {selectedMonth ? (
                  // Daily view
                  dailySpending.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailySpending} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                        <defs>
                          <linearGradient id="greenGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={1}/>
                            <stop offset="100%" stopColor="#059669" stopOpacity={0.8}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                        <XAxis 
                          dataKey="day" 
                          stroke="#6b7280" 
                          fontSize={9}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis 
                          stroke="#6b7280" 
                          fontSize={9}
                          tickFormatter={(value) => value > 1000 ? `${(value/1000).toFixed(0)}k` : `$${value}`}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip 
                          formatter={(value, name, props) => [
                            formatCurrency(value), 
                            'Total Spent'
                          ]}
                          labelFormatter={(day, payload) => {
                            if (payload && payload[0]) {
                              return `${payload[0].payload.dayName}, Day ${day} - ${payload[0].payload.invoiceCount} invoice${payload[0].payload.invoiceCount !== 1 ? 's' : ''}`;
                            }
                            return `Day ${day}`;
                          }}
                          contentStyle={{
                            backgroundColor: 'white',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            fontSize: '10px'
                          }}
                        />
                        <Bar 
                          dataKey="total" 
                          fill="url(#greenGradient)"
                          radius={[6, 6, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500">
                      <IconChartBar size={20} className="mb-1" />
                      <p className="text-[10px]">No spending data for {selectedMonth.name}</p>
                    </div>
                  )
                ) : (
                  // Monthly view
                  dashboardData.monthlySpending.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart 
                          data={dashboardData.monthlySpending} 
                          margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
                        >
                          <defs>
                            <linearGradient id="blueGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#3b82f6" stopOpacity={1}/>
                              <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.8}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                          <XAxis 
                            dataKey="month" 
                            stroke="#6b7280" 
                            fontSize={9}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis 
                            stroke="#6b7280" 
                            fontSize={9}
                            tickFormatter={(value) => `${(value/1000).toFixed(0)}k`}
                            tickLine={false}
                            axisLine={false}
                          />
                          <Tooltip 
                            formatter={(value) => [formatCurrency(value), 'Total Spent']}
                            labelFormatter={(month, payload) => {
                              if (payload && payload[0]) {
                                return `${month} - ${payload[0].payload.invoiceCount} invoice${payload[0].payload.invoiceCount !== 1 ? 's' : ''} (Click to view daily)`;
                              }
                              return month;
                            }}
                            contentStyle={{
                              backgroundColor: 'white',
                              border: '1px solid #e5e7eb',
                              borderRadius: '6px',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                              fontSize: '10px'
                            }}
                          />
                          <Bar 
                            dataKey="total" 
                            fill="url(#blueGradient)"
                            radius={[8, 8, 0, 0]}
                            style={{ cursor: 'pointer' }}
                            onClick={handleMonthClick}
                          >
                            {dashboardData.monthlySpending.map((entry, index) => (
                              <Cell 
                                key={`cell-${index}`} 
                                fill={entry.total > 5000 ? '#ef4444' : entry.total > 2000 ? '#f59e0b' : 'url(#blueGradient)'} 
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500">
                      <IconChartBar size={20} className="mb-1" />
                      <p className="text-[10px]">No spending data</p>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Bottom Row - Key Metrics */}
          <div className="col-span-5">
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 h-[200px]">
              <h3 className="text-xs font-semibold text-gray-900 mb-2">Key Metrics</h3>
              <div className="grid grid-cols-2 gap-2" style={{ height: 'calc(100% - 25px)' }}>
                <div 
                  className="bg-blue-50 rounded-md p-2 cursor-pointer hover:bg-blue-100 transition-colors flex flex-col justify-center h-full"
                  onClick={() => router.push('/client/invoices')}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="flex items-center justify-center w-4 h-4 bg-blue-100 rounded">
                      <IconFileText size={10} className="text-blue-600" />
                    </div>
                    <div className="text-sm font-bold text-gray-900">{dashboardData.totalInvoices}</div>
                  </div>
                  <div className="text-[10px] text-gray-600">Invoices</div>
                </div>
                
                <div 
                  className="bg-blue-50 rounded-md p-2 cursor-pointer hover:bg-blue-100 transition-colors flex flex-col justify-center h-full"
                  onClick={() => router.push('/client/ingredients')}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="flex items-center justify-center w-4 h-4 bg-blue-100 rounded">
                      <IconClipboardList size={10} className="text-blue-600" />
                    </div>
                    <div className="text-sm font-bold text-gray-900">{dashboardData.totalIngredients}</div>
                  </div>
                  <div className="text-[10px] text-gray-600">Ingredients</div>
                </div>
                
                <div 
                  className="bg-blue-50 rounded-md p-2 cursor-pointer hover:bg-blue-100 transition-colors flex flex-col justify-center h-full"
                  onClick={() => router.push('/client/menu-items')}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="flex items-center justify-center w-4 h-4 bg-blue-100 rounded">
                      <IconChefHat size={10} className="text-blue-600" />
                    </div>
                    <div className="text-sm font-bold text-gray-900">{dashboardData.totalMenuItems}</div>
                  </div>
                  <div className="text-[10px] text-gray-600">Menu Items</div>
                </div>
                
                <div className="bg-blue-50 rounded-md p-2 flex flex-col justify-center h-full">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="flex items-center justify-center w-4 h-4 bg-blue-100 rounded">
                      <IconCurrencyDollar size={10} className="text-blue-600" />
                    </div>
                    <div 
                      className="text-sm font-bold"
                      style={{ color: getMarginColor(dashboardData.averageMargin) }}
                    >
                      {dashboardData.averageMargin.toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-600">Avg Margin</div>
                </div>
              </div>
            </div>
          </div>

          {/* Menu Analysis */}
          <div className="col-span-7">
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 h-[200px] flex flex-col">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <h3 className="text-xs font-semibold text-gray-900">Menu Analysis</h3>
                <div className="flex bg-gray-100 rounded-md p-0.5">
                  <button
                    onClick={() => setMarginView("Highest-Margin")}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      marginView === "Highest-Margin" 
                        ? 'bg-white text-gray-900 shadow-sm' 
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    High
                  </button>
                  <button
                    onClick={() => setMarginView("Lowest-Margin")}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      marginView === "Lowest-Margin" 
                        ? 'bg-white text-gray-900 shadow-sm' 
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Low
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto">
                {getMarginItems().slice(0, 3).map((item, index) => (
                  <div key={item.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-md">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-gray-900 text-xs truncate">{item.name}</h4>
                      <p className="text-[10px] text-gray-500">{formatCurrencyDetailed(item.price)}</p>
                    </div>
                    <div className="text-right ml-2 flex-shrink-0">
                      <div 
                        className="font-semibold text-xs"
                        style={{ color: getMarginColor(item.margin) }}
                      >
                        {item.margin.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ClientLayout>
      <Analytics />
      <SpeedInsights />
    </GeometricBackground>
  );
}