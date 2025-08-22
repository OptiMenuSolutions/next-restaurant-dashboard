// pages/client/ingredients/[id].js
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import ClientLayout from "../../../components/ClientLayout";
import supabase from "../../../lib/supabaseClient";
import {
  IconArrowLeft,
  IconCurrencyDollar,
  IconCalendar,
  IconPackage,
  IconChartLine,
  IconAlertTriangle,
  IconChefHat,
  IconClipboardList,
  IconTrendingUp,
} from "@tabler/icons-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function IngredientDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [ingredient, setIngredient] = useState(null);
  const [purchaseHistory, setPurchaseHistory] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restaurantId, setRestaurantId] = useState(null);

  useEffect(() => {
    getRestaurantId();
  }, []);

  useEffect(() => {
    if (restaurantId && id) {
      fetchIngredientData();
    }
  }, [restaurantId, id]);

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
        .select("restaurant_id")
        .eq("id", user.id)
        .single();

      if (error || !data?.restaurant_id) {
        setError("Could not determine restaurant access");
        setLoading(false);
        return;
      }

      setRestaurantId(data.restaurant_id);
    } catch (err) {
      setError("An unexpected error occurred");
      setLoading(false);
    }
  }

  async function fetchIngredientData() {
    try {
      setLoading(true);
      setError("");

      // Fetch ingredient details
      const { data: ingredientData, error: ingredientError } = await supabase
        .from("ingredients")
        .select("*")
        .eq("id", id)
        .eq("restaurant_id", restaurantId)
        .single();

      if (ingredientError) {
        if (ingredientError.code === 'PGRST116') {
          setError("Ingredient not found or access denied");
        } else {
          setError("Failed to fetch ingredient: " + ingredientError.message);
        }
        return;
      }

      setIngredient(ingredientData);

      // Fetch purchase history from invoice items
      const { data: historyData, error: historyError } = await supabase
        .from("invoice_items")
        .select(`
          *,
          invoices (
            date,
            supplier,
            number
          )
        `)
        .eq("ingredient_id", id)
        .not("invoices.date", "is", null)
        .order("invoices(date)", { ascending: false });

      if (!historyError && historyData) {
        setPurchaseHistory(historyData);
      }

      // Fetch menu items that use this ingredient
      const { data: menuItemsData, error: menuItemsError } = await supabase
        .from("menu_item_ingredients")
        .select(`
          quantity,
          menu_items (
            id,
            name,
            price,
            cost
          )
        `)
        .eq("ingredient_id", id);

      if (!menuItemsError && menuItemsData) {
        setMenuItems(menuItemsData);
      }

    } catch (err) {
      setError("An unexpected error occurred: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function formatCurrency(amount) {
    if (!amount || amount === null || amount === undefined) {
      return "--";
    }
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) {
      return "--";
    }
    
    return numAmount.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatDate(dateString) {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return "Invalid date";
    }
  }

  function getChartData() {
    if (!purchaseHistory || purchaseHistory.length === 0) return [];
    
    return purchaseHistory
      .filter(item => item.invoices?.date && item.unit_cost > 0)
      .map(item => ({
        date: item.invoices.date,
        cost: parseFloat(item.unit_cost),
        dateLabel: formatDate(item.invoices.date),
        supplier: item.invoices.supplier || "Unknown"
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  function calculateItemCost(menuItem, quantity) {
    const unitCost = parseFloat(ingredient?.last_price || 0);
    const itemQuantity = parseFloat(quantity || 0);
    return unitCost * itemQuantity;
  }

  function getPriceStats() {
    const prices = purchaseHistory
      .filter(item => item.unit_cost > 0)
      .map(item => parseFloat(item.unit_cost));
    
    if (prices.length === 0) return null;

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;

    return { min, max, avg, count: prices.length };
  }

  const chartData = getChartData();
  const priceStats = getPriceStats();

  if (loading) {
    return (
      <ClientLayout 
        pageTitle="Ingredient Details" 
        pageDescription="Loading ingredient information..."
        pageIcon={IconChefHat}
      >
        <div className="p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
            <div className="text-gray-600">Loading ingredient details...</div>
          </div>
        </div>
      </ClientLayout>
    );
  }

  if (error) {
    return (
      <ClientLayout 
        pageTitle="Ingredient Details" 
        pageDescription="Error loading ingredient"
        pageIcon={IconAlertTriangle}
      >
        <div className="p-6 text-center">
          <div className="flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mx-auto mb-6">
            <IconAlertTriangle size={32} className="text-red-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Error Loading Ingredient</h3>
          <p className="text-gray-600 mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <button 
              onClick={() => router.push("/client/ingredients")} 
              className="inline-flex items-center gap-2 px-6 py-3 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition-colors font-medium"
            >
              <IconArrowLeft size={18} />
              Back to Ingredients
            </button>
            <button 
              onClick={() => window.location.reload()} 
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
            >
              Retry
            </button>
          </div>
        </div>
      </ClientLayout>
    );
  }

  if (!ingredient) {
    return (
      <ClientLayout 
        pageTitle="Ingredient Details" 
        pageDescription="Ingredient not found"
        pageIcon={IconChefHat}
      >
        <div className="p-6 text-center">
          <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6">
            <IconChefHat size={32} className="text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Ingredient Not Found</h3>
          <p className="text-gray-600 mb-6">The requested ingredient could not be found.</p>
          <button 
            onClick={() => router.push("/client/ingredients")} 
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
          >
            <IconArrowLeft size={18} />
            Back to Ingredients
          </button>
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout 
      pageTitle={ingredient.name} 
      pageDescription="Ingredient details and pricing history"
      pageIcon={IconChefHat}
    >
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => router.push("/client/ingredients")} 
              className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <IconArrowLeft size={18} />
              Back to Ingredients
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{ingredient.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-lg font-semibold text-green-600">
                  {ingredient.last_price ? formatCurrency(ingredient.last_price) : "No price data"}
                </span>
                <span className="text-sm text-gray-500">per {ingredient.unit || "unit"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg">
                <IconCurrencyDollar size={24} className="text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Current Price</p>
                <p className="text-xl font-bold text-gray-900">
                  {ingredient.last_price ? formatCurrency(ingredient.last_price) : "No data"}
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg">
                <IconPackage size={24} className="text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Unit</p>
                <p className="text-xl font-bold text-gray-900">
                  {ingredient.unit || "N/A"}
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-orange-100 rounded-lg">
                <IconCalendar size={24} className="text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Last Ordered</p>
                <p className="text-xl font-bold text-gray-900">
                  {formatDate(ingredient.last_ordered_at)}
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-purple-100 rounded-lg">
                <IconClipboardList size={24} className="text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Purchase Records</p>
                <p className="text-xl font-bold text-gray-900">
                  {purchaseHistory.length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Price Statistics */}
        {priceStats && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <IconTrendingUp size={20} />
                Price Statistics
              </h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-1">Lowest</p>
                  <p className="text-lg font-semibold text-green-600">{formatCurrency(priceStats.min)}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-1">Highest</p>
                  <p className="text-lg font-semibold text-red-600">{formatCurrency(priceStats.max)}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-1">Average</p>
                  <p className="text-lg font-semibold text-blue-600">{formatCurrency(priceStats.avg)}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-1">Records</p>
                  <p className="text-lg font-semibold text-gray-900">{priceStats.count}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Price Trend Chart */}
        {chartData.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <IconChartLine size={20} />
                Price Trend
              </h2>
            </div>
            <div className="p-6">
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis 
                      dataKey="dateLabel" 
                      stroke="#6b7280"
                      fontSize={12}
                    />
                    <YAxis 
                      stroke="#6b7280"
                      fontSize={12}
                      tickFormatter={(value) => `$${value.toFixed(2)}`}
                    />
                    <Tooltip 
                      formatter={(value, name) => [`$${value.toFixed(2)}`, 'Price']}
                      labelFormatter={(label) => `Date: ${label}`}
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="cost"
                      stroke="#4f46e5"
                      strokeWidth={3}
                      dot={{ fill: "#4f46e5", strokeWidth: 2, r: 5 }}
                      activeDot={{ r: 7, stroke: "#4f46e5", strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Menu Items Using This Ingredient */}
        {menuItems.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <IconChefHat size={20} />
                Used in Menu Items
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Menu Item</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Quantity Used</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Cost Contribution</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Menu Price</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Item Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {menuItems.map((item, index) => {
                    const costContribution = calculateItemCost(item.menu_items, item.quantity);
                    const menuPrice = parseFloat(item.menu_items.price || 0);
                    const totalCost = parseFloat(item.menu_items.cost || 0);
                    
                    return (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="py-4 px-6">
                          <span className="font-medium text-gray-900">
                            {item.menu_items.name}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-gray-900">
                          {item.quantity} {ingredient.unit}
                        </td>
                        <td className="py-4 px-6">
                          <span className="font-medium text-green-600">
                            {formatCurrency(costContribution)}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-gray-900">
                          {formatCurrency(menuPrice)}
                        </td>
                        <td className="py-4 px-6 text-gray-900">
                          {formatCurrency(totalCost)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Purchase History */}
        {purchaseHistory.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <IconClipboardList size={20} />
                Purchase History
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Date</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Invoice</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Supplier</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Quantity</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Unit Cost</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Total Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {purchaseHistory.map((purchase) => {
                    const totalCost = parseFloat(purchase.quantity || 0) * parseFloat(purchase.unit_cost || 0);
                    
                    return (
                      <tr 
                        key={purchase.id}
                        onClick={() => router.push(`/client/invoices/${purchase.invoice_id}`)}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="py-4 px-6 text-gray-900">
                          {formatDate(purchase.invoices?.date)}
                        </td>
                        <td className="py-4 px-6">
                          <span className="font-medium text-blue-600">
                            {purchase.invoices?.number || "N/A"}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-gray-900">
                          {purchase.invoices?.supplier || "Unknown"}
                        </td>
                        <td className="py-4 px-6 text-gray-900">
                          {purchase.quantity} {purchase.unit}
                        </td>
                        <td className="py-4 px-6">
                          <span className="font-medium text-green-600">
                            {formatCurrency(purchase.unit_cost)}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className="font-semibold text-gray-900">
                            {formatCurrency(totalCost)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty States */}
        {purchaseHistory.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
            <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6">
              <IconClipboardList size={32} className="text-gray-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-4">No Purchase History</h3>
            <p className="text-gray-600">This ingredient hasn't been recorded in any processed invoices yet.</p>
          </div>
        )}

        {menuItems.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
            <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6">
              <IconChefHat size={32} className="text-gray-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-4">Not Used in Menu Items</h3>
            <p className="text-gray-600">This ingredient isn't currently linked to any menu items.</p>
          </div>
        )}
      </div>
    </ClientLayout>
  );
}