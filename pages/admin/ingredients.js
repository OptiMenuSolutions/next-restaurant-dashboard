// pages/admin/ingredients.js
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import AdminLayout from "../../components/AdminLayout";
import supabase from "../../lib/supabaseClient";
import {
  IconSearch,
  IconX,
  IconSortAscending,
  IconSortDescending,
  IconCurrencyDollar,
  IconCalendar,
  IconPackage,
  IconEye,
  IconRefresh,
  IconAlertTriangle,
  IconChefHat,
  IconTrendingUp,
  IconClock,
  IconFilter,
} from "@tabler/icons-react";

export default function Ingredients() {
  const router = useRouter();
  const [ingredients, setIngredients] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/admin/login');
        return;
      }
      
      fetchRestaurants();
    };
    checkUser();
  }, [router]);

  useEffect(() => {
    fetchIngredients();
  }, [selectedRestaurant]);

  async function fetchRestaurants() {
    try {
      const { data, error } = await supabase
        .from('restaurants')
        .select('id, name')
        .order('name');

      if (error) throw error;
      setRestaurants(data || []);
    } catch (error) {
      console.error('Error fetching restaurants:', error);
    }
  }

  async function fetchIngredients() {
    try {
      setLoading(true);
      setError("");

      let query = supabase
        .from("ingredients")
        .select("*")
        .order("name");

      if (selectedRestaurant) {
        query = query.eq("restaurant_id", selectedRestaurant);
      }

      const { data, error } = await query;

      if (error) {
        setError("Failed to fetch ingredients: " + error.message);
        return;
      }

      setIngredients(data || []);
    } catch (err) {
      setError("An unexpected error occurred while fetching ingredients");
    } finally {
      setLoading(false);
    }
  }

  function handleSort(column) {
    if (sortBy === column) {
      setSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
  }

  function handleRowClick(id) {
    router.push(`/admin/ingredients/${id}`);
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

  const filteredIngredients = getFilteredAndSortedIngredients();
  const selectedRestaurantName = selectedRestaurant 
    ? restaurants.find(r => r.id === selectedRestaurant)?.name || ''
    : 'All Restaurants';

  // Calculate stats
  const ingredientsWithPricing = filteredIngredients.filter(i => i.last_price > 0).length;
  const recentlyOrdered = filteredIngredients.filter(i => 
    i.last_ordered_at && new Date(i.last_ordered_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  ).length;
  const avgPrice = filteredIngredients.filter(i => i.last_price > 0).length > 0
    ? filteredIngredients.filter(i => i.last_price > 0).reduce((sum, i) => sum + i.last_price, 0) / ingredientsWithPricing
    : 0;

  if (loading) {
    return (
      <AdminLayout 
        pageTitle="Ingredients" 
        pageDescription="Monitor ingredient costs and availability"
        pageIcon={IconChefHat}
      >
        <div className="p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
            <div className="text-gray-600">Loading ingredients...</div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout 
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
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
          >
            <IconRefresh size={18} />
            Retry
          </button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout 
      pageTitle="Ingredients" 
      pageDescription="Monitor ingredient costs and availability"
      pageIcon={IconChefHat}
    >
      {/* Action Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              onClick={fetchIngredients}
            >
              <IconRefresh size={18} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex items-center gap-3">
            <IconFilter size={20} className="text-gray-400" />
            <select 
              value={selectedRestaurant} 
              onChange={(e) => setSelectedRestaurant(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
            >
              <option value="">All Restaurants</option>
              {restaurants.map(restaurant => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 relative">
            <IconSearch size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search ingredients by name or unit..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
            />
            {searchTerm && (
              <button 
                onClick={clearSearch} 
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <IconX size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg">
                <IconPackage size={24} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{filteredIngredients.length}</p>
                <p className="text-gray-600">Total Ingredients</p>
                <p className="text-sm text-gray-500">{selectedRestaurantName}</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg">
                <IconCurrencyDollar size={24} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{ingredientsWithPricing}</p>
                <p className="text-gray-600">With Pricing</p>
                <p className="text-sm text-gray-500">
                  {filteredIngredients.length > 0 ? Math.round((ingredientsWithPricing / filteredIngredients.length) * 100) : 0}% coverage
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-orange-100 rounded-lg">
                <IconClock size={24} className="text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{recentlyOrdered}</p>
                <p className="text-gray-600">Recent Orders</p>
                <p className="text-sm text-gray-500">Last 30 days</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-purple-100 rounded-lg">
                <IconTrendingUp size={24} className="text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(avgPrice)}</p>
                <p className="text-gray-600">Avg Cost</p>
                <p className="text-sm text-gray-500">Per unit</p>
              </div>
            </div>
          </div>
        </div>

        {/* Ingredients Table */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">🥬 Ingredient Database</h3>
                <p className="text-gray-600">
                  {filteredIngredients.length} ingredient{filteredIngredients.length !== 1 ? 's' : ''}
                  {searchTerm && ` (filtered from ${ingredients.length})`}
                </p>
              </div>
            </div>
          </div>

          {filteredIngredients.length === 0 ? (
            <div className="text-center py-12">
              {searchTerm ? (
                <>
                  <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6">
                    <IconSearch size={32} className="text-gray-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">No ingredients found</h3>
                  <p className="text-gray-600 mb-6">No ingredients match your search term "{searchTerm}"</p>
                  <button 
                    onClick={clearSearch} 
                    className="inline-flex items-center gap-2 px-6 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
                  >
                    <IconX size={18} />
                    Clear search
                  </button>
                </>
              ) : ingredients.length === 0 ? (
                <>
                  <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6">
                    <IconChefHat size={32} className="text-gray-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">No ingredients yet</h3>
                  <p className="text-gray-600 mb-6">Ingredients will appear here after invoices are processed by the admin team.</p>
                </>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto">
              {/* Desktop Table */}
              <div className="hidden lg:block">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th 
                        onClick={() => handleSort("name")}
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-2">
                          Ingredient Name
                          {sortBy === "name" && (
                            sortOrder === "asc" ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th 
                        onClick={() => handleSort("last_price")}
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-2">
                          Latest Cost
                          {sortBy === "last_price" && (
                            sortOrder === "asc" ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th 
                        onClick={() => handleSort("unit")}
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-2">
                          Unit
                          {sortBy === "unit" && (
                            sortOrder === "asc" ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th 
                        onClick={() => handleSort("last_ordered_at")}
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-2">
                          Last Ordered
                          {sortBy === "last_ordered_at" && (
                            sortOrder === "asc" ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredIngredients.map((ingredient) => {
                      const hasRecentPrice = ingredient.last_price && ingredient.last_price > 0;
                      const isRecentlyOrdered = ingredient.last_ordered_at && 
                        new Date(ingredient.last_ordered_at) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
                      
                      return (
                        <tr
                          key={ingredient.id}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => handleRowClick(ingredient.id)}
                        >
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center justify-center w-10 h-10 bg-green-100 rounded-lg">
                                <IconChefHat size={18} className="text-green-600" />
                              </div>
                              <div>
                                <div className="font-medium text-gray-900">
                                  {ingredient.name || "Unnamed ingredient"}
                                </div>
                                {isRecentlyOrdered && (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                    Recently ordered
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <IconCurrencyDollar size={16} className="text-gray-400" />
                              {hasRecentPrice ? (
                                <span className="font-medium text-gray-900">
                                  {formatCurrency(ingredient.last_price)}
                                </span>
                              ) : (
                                <span className="text-gray-400 italic">No price data</span>
                              )}
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <IconPackage size={16} className="text-gray-400" />
                              <span className="text-gray-900">
                                {ingredient.unit || "N/A"}
                              </span>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <IconCalendar size={16} className="text-gray-400" />
                              <span className="text-gray-900">
                                {formatDate(ingredient.last_ordered_at)}
                              </span>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRowClick(ingredient.id);
                              }}
                              className="flex items-center gap-1 px-3 py-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors text-sm"
                              title="View Details"
                            >
                              <IconEye size={16} />
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="lg:hidden">
                {filteredIngredients.map((ingredient) => {
                  const hasRecentPrice = ingredient.last_price && ingredient.last_price > 0;
                  const isRecentlyOrdered = ingredient.last_ordered_at && 
                    new Date(ingredient.last_ordered_at) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
                  
                  return (
                    <div 
                      key={ingredient.id} 
                      className="p-6 border-b border-gray-200 last:border-b-0 cursor-pointer hover:bg-gray-50"
                      onClick={() => handleRowClick(ingredient.id)}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg">
                            <IconChefHat size={20} className="text-green-600" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">
                              {ingredient.name || "Unnamed ingredient"}
                            </h3>
                            <div className="text-sm text-gray-500">
                              Unit: {ingredient.unit || "N/A"}
                            </div>
                          </div>
                        </div>
                        
                        {isRecentlyOrdered && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Recent
                          </span>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <div className="text-sm text-gray-500 mb-1">Latest Cost</div>
                          <div className="text-sm font-medium text-gray-900">
                            {hasRecentPrice ? formatCurrency(ingredient.last_price) : 'No price data'}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500 mb-1">Last Ordered</div>
                          <div className="text-sm font-medium text-gray-900">
                            {formatDate(ingredient.last_ordered_at)}
                          </div>
                        </div>
                      </div>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowClick(ingredient.id);
                        }}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors text-sm"
                      >
                        <IconEye size={16} />
                        View Details
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}