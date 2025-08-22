// pages/admin/analytics.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconTrendingUp,
  IconFilter,
  IconCurrencyDollar,
  IconFileText,
  IconBook,
  IconToolsKitchen2,
  IconArrowUp,
  IconArrowDown,
  IconCalendar,
  IconRefresh,
} from '@tabler/icons-react';

export default function Analytics() {
  const router = useRouter();
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analytics, setAnalytics] = useState({
    costHistory: [],
    ingredientTrends: [],
    menuItemStats: [],
    invoiceStats: {}
  });

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
    if (selectedRestaurant) {
      fetchAnalytics();
    }
  }, [selectedRestaurant]);

  async function fetchRestaurants() {
    try {
      const { data, error } = await supabase
        .from('restaurants')
        .select('id, name')
        .order('name');

      if (error) throw error;
      setRestaurants(data || []);
      
      // Auto-select first restaurant if available
      if (data && data.length > 0) {
        setSelectedRestaurant(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching restaurants:', error);
    }
  }

  async function fetchAnalytics() {
    if (!selectedRestaurant) return;
    
    try {
      setRefreshing(true);
      
      // Fetch cost history
      const { data: costHistory, error: costError } = await supabase
        .from('menu_item_cost_history')
        .select('*')
        .eq('restaurant_id', selectedRestaurant)
        .order('created_at', { ascending: false })
        .limit(50);

      if (costError) throw costError;

      // Fetch ingredient price trends
      const { data: ingredients, error: ingredientError } = await supabase
        .from('ingredients')
        .select('*')
        .eq('restaurant_id', selectedRestaurant)
        .order('last_ordered_at', { ascending: false });

      if (ingredientError) throw ingredientError;

      // Fetch menu items with current costs
      const { data: menuItems, error: menuError } = await supabase
        .from('menu_items')
        .select('*')
        .eq('restaurant_id', selectedRestaurant)
        .order('cost', { ascending: false });

      if (menuError) throw menuError;

      // Fetch invoice statistics
      const { data: invoices, error: invoiceError } = await supabase
        .from('invoices')
        .select('*')
        .eq('restaurant_id', selectedRestaurant);

      if (invoiceError) throw invoiceError;

      // Calculate invoice stats
      const invoiceStats = {
        total: invoices.length,
        totalValue: invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0),
        avgValue: invoices.length > 0 ? invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0) / invoices.length : 0,
        lastMonth: invoices.filter(inv => {
          const invDate = new Date(inv.created_at);
          const lastMonth = new Date();
          lastMonth.setMonth(lastMonth.getMonth() - 1);
          return invDate >= lastMonth;
        }).length
      };

      setAnalytics({
        costHistory: costHistory || [],
        ingredientTrends: ingredients || [],
        menuItemStats: menuItems || [],
        invoiceStats
      });
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const selectedRestaurantName = restaurants.find(r => r.id === selectedRestaurant)?.name || '';

  // Calculate cost change trends
  const recentCostChanges = analytics.costHistory.slice(0, 10);
  const avgCostChange = recentCostChanges.length > 0 
    ? recentCostChanges.reduce((sum, change) => {
        const changeAmount = change.new_cost - change.old_cost;
        return sum + changeAmount;
      }, 0) / recentCostChanges.length
    : 0;

  // Find most expensive ingredients
  const topExpensiveIngredients = analytics.ingredientTrends
    .filter(ing => ing.last_price > 0)
    .sort((a, b) => b.last_price - a.last_price)
    .slice(0, 5);

  // Find most expensive menu items
  const topExpensiveMenuItems = analytics.menuItemStats
    .filter(item => item.cost > 0)
    .slice(0, 5);

  if (loading) {
    return (
      <AdminLayout 
        pageTitle="Analytics Dashboard" 
        pageDescription="Cost trends and performance insights"
        pageIcon={IconTrendingUp}
      >
        <div className="p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
            <p className="text-gray-600">Loading analytics...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout 
      pageTitle="Analytics Dashboard" 
      pageDescription="Cost trends and performance insights"
      pageIcon={IconTrendingUp}
    >
      {/* Controls */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconFilter size={20} className="text-gray-400" />
            <select 
              value={selectedRestaurant} 
              onChange={(e) => setSelectedRestaurant(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
            >
              <option value="">Select a restaurant...</option>
              {restaurants.map(restaurant => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name}
                </option>
              ))}
            </select>
          </div>
          <button 
            onClick={fetchAnalytics}
            disabled={refreshing || !selectedRestaurant}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <IconRefresh size={18} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="p-6">
        {!selectedRestaurant ? (
          // Empty State
          <div className="max-w-md mx-auto text-center py-12">
            <div className="flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mx-auto mb-6">
              <IconTrendingUp size={32} className="text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Select a Restaurant</h2>
            <p className="text-gray-600 mb-6">
              Choose a restaurant from the dropdown above to view detailed analytics and cost trends.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg">
                    <IconCurrencyDollar size={24} className="text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">
                      ${analytics.invoiceStats.totalValue?.toFixed(2) || '0.00'}
                    </p>
                    <p className="text-gray-600">Total Invoice Value</p>
                    <p className="text-sm text-gray-500">From {analytics.invoiceStats.total} invoices</p>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${avgCostChange >= 0 ? 'bg-red-100' : 'bg-green-100'}`}>
                    {avgCostChange >= 0 ? 
                      <IconArrowUp size={24} className="text-red-600" /> : 
                      <IconArrowDown size={24} className="text-green-600" />
                    }
                  </div>
                  <div>
                    <p className={`text-2xl font-bold ${avgCostChange >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {avgCostChange >= 0 ? '+' : ''}${avgCostChange.toFixed(4)}
                    </p>
                    <p className="text-gray-600">Avg Cost Change</p>
                    <p className="text-sm text-gray-500">Recent 10 changes</p>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg">
                    <IconToolsKitchen2 size={24} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{analytics.menuItemStats.length}</p>
                    <p className="text-gray-600">Menu Items</p>
                    <p className="text-sm text-gray-500">Total items tracked</p>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 bg-orange-100 rounded-lg">
                    <IconBook size={24} className="text-orange-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{analytics.ingredientTrends.length}</p>
                    <p className="text-gray-600">Ingredients</p>
                    <p className="text-sm text-gray-500">With pricing data</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Cost Changes */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Recent Cost Changes</h2>
              </div>
              {recentCostChanges.length === 0 ? (
                <div className="text-center py-12">
                  <IconFileText size={48} className="mx-auto mb-4 text-gray-300" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Cost Changes</h3>
                  <p className="text-gray-600">No recent cost changes found for this restaurant.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Date</th>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Menu Item</th>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Old Cost</th>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">New Cost</th>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Change</th>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {recentCostChanges.map(change => {
                        const changeAmount = change.new_cost - change.old_cost;
                        const changePercent = change.old_cost > 0 ? (changeAmount / change.old_cost * 100) : 0;
                        
                        return (
                          <tr key={change.id} className="hover:bg-gray-50">
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-2">
                                <IconCalendar size={16} className="text-gray-400" />
                                <span className="text-gray-900">
                                  {new Date(change.created_at).toLocaleDateString()}
                                </span>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <div className="font-medium text-gray-900">{change.menu_item_name}</div>
                            </td>
                            <td className="py-4 px-6 text-gray-900">${change.old_cost.toFixed(4)}</td>
                            <td className="py-4 px-6 text-gray-900">${change.new_cost.toFixed(4)}</td>
                            <td className="py-4 px-6">
                              <div className={`font-medium ${changeAmount >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {changeAmount >= 0 ? '+' : ''}${changeAmount.toFixed(4)}
                                <div className="text-xs text-gray-500">
                                  ({changePercent >= 0 ? '+' : ''}{changePercent.toFixed(1)}%)
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-6 text-gray-600">{change.change_reason}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Most Expensive Ingredients */}
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">Most Expensive Ingredients</h2>
                </div>
                {topExpensiveIngredients.length === 0 ? (
                  <div className="text-center py-12">
                    <IconBook size={48} className="mx-auto mb-4 text-gray-300" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Ingredient Data</h3>
                    <p className="text-gray-600">No ingredient pricing data available.</p>
                  </div>
                ) : (
                  <div className="p-6 space-y-4">
                    {topExpensiveIngredients.map((ingredient, index) => (
                      <div key={ingredient.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center justify-center w-8 h-8 bg-[#ADD8E6] text-gray-900 rounded-lg font-semibold text-sm">
                          #{index + 1}
                        </div>
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{ingredient.name}</h4>
                          <p className="text-sm text-gray-600">${ingredient.last_price.toFixed(4)} per {ingredient.unit}</p>
                          {ingredient.last_ordered_at && (
                            <p className="text-xs text-gray-500">
                              Last ordered: {new Date(ingredient.last_ordered_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Most Expensive Menu Items */}
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">Most Expensive Menu Items</h2>
                </div>
                {topExpensiveMenuItems.length === 0 ? (
                  <div className="text-center py-12">
                    <IconToolsKitchen2 size={48} className="mx-auto mb-4 text-gray-300" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Menu Data</h3>
                    <p className="text-gray-600">No menu item cost data available.</p>
                  </div>
                ) : (
                  <div className="p-6 space-y-4">
                    {topExpensiveMenuItems.map((item, index) => (
                      <div key={item.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center justify-center w-8 h-8 bg-[#ADD8E6] text-gray-900 rounded-lg font-semibold text-sm">
                          #{index + 1}
                        </div>
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{item.name}</h4>
                          <p className="text-sm text-gray-600">Cost: ${item.cost.toFixed(4)}</p>
                          {item.price && (
                            <p className="text-xs text-gray-500">
                              Margin: ${(item.price - item.cost).toFixed(2)} 
                              ({((item.price - item.cost) / item.price * 100).toFixed(1)}%)
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}