// pages/client/ingredients.js - Complete updated version with IngredientSearch
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import ClientLayout from "../../components/ClientLayout";
import IngredientSearch from "../../components/IngredientSearch";
import supabase from "../../lib/supabaseClient";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  IconSearch,
  IconX,
  IconChefHat,
  IconAlertTriangle,
  IconRefresh,
  IconCurrencyDollar,
  IconCalendar,
  IconFileText,
  IconSortAscending,
  IconSortDescending,
  IconChartBar,
  IconActivity,
  IconPackage,
  IconPlus,
} from "@tabler/icons-react";

export default function Ingredients() {
  const router = useRouter();
  const { selected } = router.query; // Get selected ingredient ID from query params
  
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restaurantId, setRestaurantId] = useState(null);
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIngredient, setSelectedIngredient] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [purchaseHistory, setPurchaseHistory] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [userName, setUserName] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const getUserInitials = (name) => {
    if (!name) return "U";
    return name.split(' ')
      .map(part => part.charAt(0))
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  useEffect(() => {
    getRestaurantId();
  }, []);

  useEffect(() => {
    if (restaurantId) {
      fetchIngredients();
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
    } catch (err) {
      setError("An unexpected error occurred");
      setLoading(false);
    }
  }

  async function fetchIngredients() {
    try {
      setLoading(true);
      setError("");

      const { data, error } = await supabase
        .from("ingredients")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("name");

      if (error) {
        setError("Failed to fetch ingredients: " + error.message);
        return;
      }

      setIngredients(data || []);

      // Auto-select ingredient if selected query parameter is provided
      if (selected && data) {
        const selectedIngredientData = data.find(ingredient => ingredient.id === selected);
        if (selectedIngredientData) {
          handleIngredientSelect(selectedIngredientData);
        }
      }
    } catch (err) {
      setError("An unexpected error occurred while fetching ingredients");
    } finally {
      setLoading(false);
    }
  }

  async function fetchIngredientDetail(ingredientId) {
    try {
      setLoadingDetail(true);
      
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
        .eq("ingredient_id", ingredientId)
        .not("invoices.date", "is", null)
        .order("invoices(date)", { ascending: false });

      if (historyError) {
        console.error('Error fetching history data:', historyError);
        setPriceHistory([]);
        setPurchaseHistory([]);
        return;
      }

      if (historyData && historyData.length > 0) {
        // Process price history for chart (chronological order for chart)
        const chartData = historyData
          .filter(item => item.invoices?.date && item.unit_cost > 0)
          .map(item => ({
            date: item.invoices.date,
            price: parseFloat(item.unit_cost),
            supplier: item.invoices.supplier || 'Unknown',
            invoiceNumber: item.invoices.number || 'N/A',
            quantity: item.quantity || 0
          }))
          .sort((a, b) => new Date(a.date) - new Date(b.date)); // Sort chronologically for chart

        setPriceHistory(chartData);
        setPurchaseHistory(historyData); // Keep original order (newest first) for purchase history
      } else {
        setPriceHistory([]);
        setPurchaseHistory([]);
      }

    } catch (error) {
      console.error('Error fetching ingredient detail:', error);
      setPriceHistory([]);
      setPurchaseHistory([]);
    } finally {
      setLoadingDetail(false);
    }
  }

  function handleIngredientSelect(ingredient) {
    setSelectedIngredient(ingredient);
    fetchIngredientDetail(ingredient.id);
    
    // Update URL without triggering a page reload
    router.replace(`/client/ingredients?selected=${ingredient.id}`, undefined, { shallow: true });
  }

  // Handle ingredient selection from search
  function handleSearchIngredientSelect(ingredient) {
    handleIngredientSelect(ingredient);
  }

  function handleSort(column) {
    if (sortBy === column) {
      setSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
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
      maximumFractionDigits: 4
    });
  }

  function formatDate(dateString) {
    if (!dateString) return "Never";
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

  function getFilteredAndSortedIngredients() {
    let filtered = ingredients;

    // Apply search filter
    if (searchTerm) {
      filtered = ingredients.filter(ingredient =>
        ingredient.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ingredient.unit?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      let valueA, valueB;

      switch (sortBy) {
        case "name":
          valueA = a.name?.toLowerCase() || "";
          valueB = b.name?.toLowerCase() || "";
          break;
        case "last_price":
          valueA = parseFloat(a.last_price) || 0;
          valueB = parseFloat(b.last_price) || 0;
          break;
        case "unit":
          valueA = a.unit?.toLowerCase() || "";
          valueB = b.unit?.toLowerCase() || "";
          break;
        case "last_ordered_at":
          valueA = new Date(a.last_ordered_at || "1970-01-01");
          valueB = new Date(b.last_ordered_at || "1970-01-01");
          break;
        default:
          return 0;
      }

      if (valueA < valueB) return sortOrder === "asc" ? -1 : 1;
      if (valueA > valueB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }

  function clearSearch() {
    setSearchTerm("");
  }

  function calculateStats() {
    if (!selectedIngredient || priceHistory.length === 0) {
      return {
        avgPrice: 0,
        priceChange: 0,
        totalPurchases: 0,
        lastOrderDate: null
      };
    }

    const prices = priceHistory.map(p => p.price);
    const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const priceChange = firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

    return {
      avgPrice,
      priceChange,
      totalPurchases: purchaseHistory.length,
      lastOrderDate: purchaseHistory.length > 0 ? purchaseHistory[purchaseHistory.length - 1]?.invoices?.date : null
    };
  }

  const filteredIngredients = getFilteredAndSortedIngredients();
  const stats = calculateStats();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Loading Ingredients</h3>
          <p className="text-gray-600">Fetching your ingredient data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <ClientLayout 
        pageTitle="Ingredients" 
        pageDescription="Error loading ingredients"
        pageIcon={IconAlertTriangle}
      >
        <div className="p-6 text-center">
          <div className="flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mx-auto mb-6">
            <IconAlertTriangle size={32} className="text-red-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Error Loading Ingredients</h3>
          <p className="text-gray-600 mb-6">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            <IconRefresh size={18} />
            Retry
          </button>
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout 
      pageTitle="Ingredients" 
      pageDescription="Monitor ingredient costs and availability"
      pageIcon={IconChefHat}
    >
      {/* Header Section - Updated to use IngredientSearch */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ingredient Inventory</h1>
          <p className="text-gray-600 text-sm mt-1">Monitor costs and stock levels</p>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Ingredient Search Bar */}
          <div className="w-96">
            <IngredientSearch 
              restaurantId={restaurantId}
              onIngredientSelect={handleSearchIngredientSelect}
              placeholder="Search ingredients by name or unit..."
            />
          </div>
          
          {/* Add Ingredient Button */}
          <button 
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center gap-2"
          >
            <IconPlus size={16} />
            Add Ingredient
          </button>
          
          {/* User Profile Circle */}
          <div className="flex items-center justify-center w-10 h-10 bg-blue-600 text-white rounded-full font-semibold text-sm cursor-pointer hover:bg-blue-700 transition-colors">
            {getUserInitials(userName)}
          </div>
        </div>
      </div>

      {/* Main Layout - Split View */}
      <div className="flex gap-4 h-[calc(100vh-200px)]">
        
        {/* Ingredient List - Left Side (55% width) */}
        <div className="w-[55%] bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 flex-shrink-0 bg-gradient-to-r from-blue-50 to-indigo-50">
            <h3 className="text-lg font-semibold text-gray-900">Ingredient List</h3>
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-4 gap-4 p-4 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-900 flex-shrink-0">
            <div 
              className="cursor-pointer hover:text-blue-600 flex items-center gap-1"
              onClick={() => handleSort("name")}
            >
              Name
              {sortBy === "name" && (
                sortOrder === "asc" ? <IconSortAscending size={14} /> : <IconSortDescending size={14} />
              )}
            </div>
            <div 
              className="cursor-pointer hover:text-blue-600 flex items-center gap-1"
              onClick={() => handleSort("last_price")}
            >
              Latest Price
              {sortBy === "last_price" && (
                sortOrder === "asc" ? <IconSortAscending size={14} /> : <IconSortDescending size={14} />
              )}
            </div>
            <div 
              className="cursor-pointer hover:text-blue-600 flex items-center gap-1"
              onClick={() => handleSort("unit")}
            >
              Unit
              {sortBy === "unit" && (
                sortOrder === "asc" ? <IconSortAscending size={14} /> : <IconSortDescending size={14} />
              )}
            </div>
            <div 
              className="cursor-pointer hover:text-blue-600 flex items-center gap-1"
              onClick={() => handleSort("last_ordered_at")}
            >
              Last Ordered
              {sortBy === "last_ordered_at" && (
                sortOrder === "asc" ? <IconSortAscending size={14} /> : <IconSortDescending size={14} />
              )}
            </div>
          </div>

          {/* Ingredient List Content */}
          <div className="flex-1 overflow-y-auto">
            {filteredIngredients.length === 0 ? (
              <div className="text-center py-12">
                <IconChefHat size={48} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Ingredients Found</h3>
                <p className="text-gray-600 mb-6">
                  {searchTerm 
                    ? `No ingredients match "${searchTerm}"`
                    : 'Ingredients will appear here after invoices are processed!'
                  }
                </p>
                {searchTerm && (
                  <button
                    onClick={clearSearch}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Clear Search
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {filteredIngredients.map(ingredient => {
                  const hasRecentPrice = ingredient.last_price && ingredient.last_price > 0;
                  const isRecentlyOrdered = ingredient.last_ordered_at && 
                    new Date(ingredient.last_ordered_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                  
                  return (
                    <div 
                      key={ingredient.id} 
                      className={`grid grid-cols-4 gap-4 p-3 rounded-lg cursor-pointer transition-all duration-200 ${
                        selectedIngredient?.id === ingredient.id 
                          ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-300 shadow-sm' 
                          : 'hover:bg-gradient-to-r hover:from-gray-50 hover:to-blue-25 hover:shadow-sm'
                      }`}
                      onClick={() => handleIngredientSelect(ingredient)}
                    >
                      <div className="truncate">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center flex-shrink-0">
                            <IconChefHat size={12} className="text-blue-600" />
                          </div>
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {ingredient.name || "Unnamed"}
                          </span>
                        </div>
                        {isRecentlyOrdered && (
                          <span className="inline-block mt-1 px-1 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                            Recent
                          </span>
                        )}
                      </div>
                      <div className="truncate">
                        <span className="text-sm text-gray-900">
                          {hasRecentPrice ? formatCurrency(ingredient.last_price) : <span className="text-gray-400 italic">No price</span>}
                        </span>
                      </div>
                      <div className="truncate">
                        <span className="text-sm text-gray-900">
                          {ingredient.unit || <span className="text-gray-400 italic">N/A</span>}
                        </span>
                      </div>
                      <div className="truncate">
                        <span className="text-sm text-gray-900">
                          {formatDate(ingredient.last_ordered_at)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Ingredient Detail - Right Side (45% width) */}
        <div className="w-[45%] bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
          {selectedIngredient ? (
            <>
              {/* Header */}
              <div className="p-4 border-b border-gray-200 flex-shrink-0 bg-gradient-to-r from-emerald-50 to-teal-50">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Ingredient Detail</h3>
                  <div className="flex items-center gap-2">
                    <IconPackage size={16} className="text-emerald-600" />
                    <span className="text-sm font-medium text-emerald-700">{selectedIngredient.unit || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Detail Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Ingredient Information */}
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-gray-900 border-b-2 border-blue-200 pb-2">Ingredient Information</h4>
                  <div className="bg-gradient-to-br from-gray-50 to-blue-50 p-4 rounded-lg">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center">
                        <div className="text-sm font-bold text-blue-700 mb-2">Name</div>
                        <div className="text-sm text-gray-700">{selectedIngredient.name || "Unnamed Ingredient"}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-bold text-blue-700 mb-2">Current Price</div>
                        <div className="text-lg font-bold text-emerald-600">
                          {selectedIngredient.last_price ? formatCurrency(selectedIngredient.last_price) : <span className="text-gray-400 italic">No price</span>}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-bold text-blue-700 mb-2">Unit</div>
                        <div className="text-sm text-gray-700">{selectedIngredient.unit || "N/A"}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-bold text-blue-700 mb-2">Last Ordered</div>
                        <div className="text-sm text-gray-700">{formatDate(selectedIngredient.last_ordered_at)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Statistics */}
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-gray-900 border-b-2 border-emerald-200 pb-2">Statistics</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-blue-600">{stats.totalPurchases}</div>
                      <div className="text-sm text-blue-700">Total Orders</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-emerald-600">{formatCurrency(stats.avgPrice)}</div>
                      <div className="text-sm text-emerald-700">Avg Price</div>
                    </div>
                    <div className={`rounded-lg p-3 text-center ${stats.priceChange >= 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                      <div className={`text-2xl font-bold ${stats.priceChange >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {stats.priceChange >= 0 ? '+' : ''}{stats.priceChange.toFixed(1)}%
                      </div>
                      <div className={`text-sm ${stats.priceChange >= 0 ? 'text-red-700' : 'text-green-700'}`}>Price Change</div>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-3 text-center">
                      <div className="text-lg font-bold text-orange-600">
                        {stats.lastOrderDate ? formatDate(stats.lastOrderDate) : 'Never'}
                      </div>
                      <div className="text-sm text-orange-700">Last Order</div>
                    </div>
                  </div>
                </div>

                {/* Price Chart */}
                {loadingDetail ? (
                  <div className="text-center py-8">
                    <div className="w-8 h-8 border-4 border-gray-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-2"></div>
                    <span className="text-gray-600">Loading price history...</span>
                  </div>
                ) : priceHistory.length > 0 ? (
                  <div className="space-y-4">
                    <h4 className="text-lg font-semibold text-gray-900 border-b-2 border-purple-200 pb-2">Price History</h4>
                    <div className="h-64 bg-gray-50 rounded-lg p-4">
                      {typeof LineChart !== 'undefined' ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={priceHistory}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis 
                              dataKey="date" 
                              stroke="#6b7280" 
                              fontSize={10}
                              tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            />
                            <YAxis 
                              stroke="#6b7280" 
                              fontSize={10}
                              tickFormatter={(value) => `${value.toFixed(2)}`}
                            />
                            <Tooltip 
                              formatter={(value) => [`${parseFloat(value).toFixed(2)}`, 'Price']}
                              labelFormatter={(date) => `Date: ${new Date(date).toLocaleDateString()}`}
                              contentStyle={{
                                backgroundColor: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                fontSize: '12px'
                              }}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="price" 
                              stroke="#10b981" 
                              strokeWidth={2}
                              dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
                              activeDot={{ r: 6, stroke: '#10b981', strokeWidth: 2 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <div className="text-center">
                            <IconChartBar size={48} className="mx-auto mb-4 text-gray-300" />
                            <p className="text-gray-600">Chart library not available</p>
                            <div className="mt-4 space-y-2">
                              {priceHistory.map((item, index) => (
                                <div key={index} className="flex justify-between text-sm">
                                  <span>{formatDate(item.date)}</span>
                                  <span className="font-medium">{formatCurrency(item.price)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="w-12 h-12 bg-gray-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                      📊
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Price History</h3>
                    <p className="text-gray-600">Price data will appear here once this ingredient is purchased.</p>
                  </div>
                )}

                {/* Purchase History */}
                {loadingDetail ? (
                  <div className="text-center py-4">
                    <span className="text-gray-600">Loading purchase history...</span>
                  </div>
                ) : purchaseHistory.length > 0 ? (
                  <div className="space-y-4">
                    <h4 className="text-lg font-semibold text-gray-900 border-b-2 border-orange-200 pb-2">Purchase History ({purchaseHistory.length})</h4>
                    <div className="space-y-3 max-h-64 overflow-y-auto">
                      {purchaseHistory.map((purchase, index) => (
                        <div key={index} className="border border-gray-200 rounded-lg p-3 bg-gradient-to-r from-gray-50 to-blue-50 hover:from-gray-100 hover:to-blue-100 transition-all duration-200">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex-1">
                              <div className="font-medium text-sm text-gray-900">
                                Invoice: {purchase.invoices?.number || 'N/A'}
                              </div>
                              <div className="text-xs text-gray-600">
                                {purchase.invoices?.supplier || 'Unknown Supplier'}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-sm text-emerald-600">
                                {formatCurrency(purchase.unit_cost)}
                              </div>
                              <div className="text-xs text-gray-600">
                                Qty: {purchase.quantity || 'N/A'}
                              </div>
                            </div>
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatDate(purchase.invoices?.date || purchase.created_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <IconFileText size={48} className="mx-auto mb-4 text-gray-300" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Purchase History</h3>
                    <p className="text-gray-600">Purchase records will appear here once this ingredient is ordered.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <IconChefHat size={64} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-xl font-medium text-gray-900 mb-2">Select an Ingredient</h3>
                <p className="text-gray-600">Choose an ingredient from the list to view its details and price history</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </ClientLayout>
  );
}