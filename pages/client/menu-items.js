// pages/client/menu-items.js
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import ClientLayout from "../../components/ClientLayout";
import supabase from "../../lib/supabaseClient";
import { calculateStandardizedCost } from "/lib/standardizedUnits";
import MenuItemSearch from "../../components/MenuItemSearch";
import {
  IconSearch,
  IconX,
  IconSortAscending,
  IconSortDescending,
  IconCurrencyDollar,
  IconEye,
  IconAlertTriangle,
  IconChefHat,
  IconTrendingUp,
  IconClock,
  IconPackage,
  IconRefresh,
  IconArrowLeft,
  IconCalendar,
  IconChartLine,
  IconClipboardList,
  IconTrendingDown,
  IconExclamationCircle,
  IconChevronRight,
  IconChevronDown,
  IconEyeOff,
  IconCheck,
  IconPlus,
} from "@tabler/icons-react";

export default function MenuItems() {
  const router = useRouter();
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restaurantId, setRestaurantId] = useState(null);
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [userName, setUserName] = useState("");
  
  // Split view state
  const [selectedMenuItem, setSelectedMenuItem] = useState(null);
  const [selectedMenuItemData, setSelectedMenuItemData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [expandedComponents, setExpandedComponents] = useState(new Set());
  const [viewMode, setViewMode] = useState('details'); // 'details' or 'optimize'
  const [optimizedIngredients, setOptimizedIngredients] = useState({});
  const [optimizedPrice, setOptimizedPrice] = useState(null);
  const [showInput, setShowInput] = useState(null);

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
      fetchMenuItems();
    }
  }, [restaurantId]);

  useEffect(() => {
    if (selectedMenuItem && restaurantId) {
      fetchMenuItemDetails(selectedMenuItem);
    }
  }, [selectedMenuItem, restaurantId]);

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

  async function fetchMenuItems() {
    try {
      setLoading(true);
      setError("");

      const { data, error } = await supabase
        .from("menu_items")
        .select(`
          *,
          menu_item_ingredients (
            quantity,
            ingredients (
              id,
              name,
              unit,
              last_price
            )
          ),
          menu_item_components (
            id,
            name,
            cost,
            component_ingredients (
              id,
              quantity,
              unit,
              ingredients:ingredient_id (
                id,
                name,
                last_price,
                unit,
                last_ordered_at
              )
            )
          )
        `)
        .eq("restaurant_id", restaurantId)
        .order("name");

      if (error) {
        setError("Failed to fetch menu items: " + error.message);
        return;
      }

      setMenuItems(data || []);
    } catch (err) {
      setError("An unexpected error occurred while fetching menu items");
    } finally {
      setLoading(false);
    }
  }

  async function fetchMenuItemDetails(menuItemId) {
    try {
      setDetailLoading(true);
      setDetailError("");

      // Fetch menu item details
      const { data: menuItemData, error: menuItemError } = await supabase
        .from("menu_items")
        .select("*")
        .eq("id", menuItemId)
        .eq("restaurant_id", restaurantId)
        .single();

      if (menuItemError) {
        setDetailError("Failed to fetch menu item details");
        return;
      }

      // Fetch ingredients and their details
      const { data: ingredientsData, error: ingredientsError } = await supabase
        .from("menu_item_ingredients")
        .select(`
          quantity,
          ingredients (
            id,
            name,
            unit,
            last_price,
            last_ordered_at
          )
        `)
        .eq("menu_item_id", menuItemId);

      // Fetch components with their ingredients
      const { data: componentsData, error: componentsError } = await supabase
        .from('menu_item_components')
        .select(`
          id,
          name,
          cost,
          component_ingredients (
            id,
            quantity,
            unit,
            ingredients:ingredient_id (
              id,
              name,
              last_price,
              unit,
              last_ordered_at
            )
          )
        `)
        .eq('menu_item_id', menuItemId)
        .order('name');

      // Fetch cost history
      const { data: historyData, error: historyError } = await supabase
        .from("menu_item_cost_history")
        .select("*")
        .eq("menu_item_id", menuItemId)
        .order("created_at", { ascending: false })
        .limit(10);

      // Process components with calculated costs
      let processedComponents = [];
      if (!componentsError && componentsData) {
        processedComponents = (componentsData || []).map(component => {
          const processedIngredients = (component.component_ingredients || []).map(ing => {
            const ingredient = ing.ingredients;
            const recipeQuantity = ing.quantity;
            const recipeUnit = ing.unit;
            const ingredientCost = ingredient?.last_price || 0;
            const ingredientName = ingredient?.name || 'Unknown';

            let calculatedCost = 0;
            if (ingredientCost > 0) {
              try {
                if (typeof calculateStandardizedCost === 'function') {
                  calculatedCost = calculateStandardizedCost(
                    recipeQuantity,
                    recipeUnit,
                    ingredientCost,
                    ingredientName
                  );
                } else {
                  calculatedCost = recipeQuantity * ingredientCost;
                }
              } catch (error) {
                console.warn(`Cost calculation failed for ${ingredientName}:`, error);
                calculatedCost = recipeQuantity * ingredientCost;
              }
            }

            return {
              id: ing.id,
              ingredientId: ingredient?.id,
              name: ingredientName,
              quantity: recipeQuantity,
              unit: recipeUnit,
              unitCost: ingredientCost,
              standardUnit: ingredient?.unit || 'unknown',
              totalCost: calculatedCost,
              lastOrdered: ingredient?.last_ordered_at,
              hasPrice: ingredientCost > 0
            };
          });

          const calculatedTotal = processedIngredients.reduce((sum, ing) => sum + ing.totalCost, 0);

          return {
            id: component.id,
            name: component.name,
            storedCost: component.cost || 0,
            calculatedCost: calculatedTotal,
            ingredients: processedIngredients,
            ingredientCount: processedIngredients.length
          };
        });
      }

      setSelectedMenuItemData({
        menuItem: menuItemData,
        ingredients: ingredientsData || [],
        components: processedComponents,
        costHistory: historyData || []
      });

    } catch (err) {
      setDetailError("An unexpected error occurred: " + err.message);
    } finally {
      setDetailLoading(false);
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

  function handleCardClick(menuItemOrId) {
    // Handle both direct ID clicks and menu item object selection from search
    const id = typeof menuItemOrId === 'object' ? menuItemOrId.id : menuItemOrId;
    setSelectedMenuItem(id);
    setExpandedComponents(new Set()); // Reset expanded components
    setViewMode('details');
    resetOptimizer();
  }

  function handleCloseDetail() {
    setSelectedMenuItem(null);
    setSelectedMenuItemData(null);
    setDetailError("");
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

  function calculateMargin(price, cost) {
    const priceNum = parseFloat(price || 0);
    const costNum = parseFloat(cost || 0);
    
    if (priceNum === 0 || costNum === 0) return "--";
    
    const margin = ((priceNum - costNum) / priceNum) * 100;
    return margin.toFixed(1) + "%";
  }

  function getMarginColor(price, cost) {
    const priceNum = parseFloat(price || 0);
    const costNum = parseFloat(cost || 0);
    
    if (priceNum === 0 || costNum === 0) return "text-gray-400";
    
    const margin = ((priceNum - costNum) / priceNum) * 100;
    
    if (margin >= 70) return "text-green-600 font-semibold";
    if (margin >= 50) return "text-green-500 font-medium";
    if (margin >= 30) return "text-yellow-600 font-medium";
    return "text-red-500 font-semibold";
  }

  function getFilteredAndSortedMenuItems() {
    let filtered = menuItems;

    if (searchTerm) {
      filtered = menuItems.filter(item =>
        item.name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (categoryFilter !== "All") {
      // Placeholder for future category functionality
    }

    const sorted = [...filtered].sort((a, b) => {
      let valueA, valueB;

      switch (sortBy) {
        case "name":
          valueA = a.name?.toLowerCase() || "";
          valueB = b.name?.toLowerCase() || "";
          break;
        case "price":
          valueA = parseFloat(a.price) || 0;
          valueB = parseFloat(b.price) || 0;
          break;
        case "cost":
          valueA = parseFloat(a.cost) || 0;
          valueB = parseFloat(b.cost) || 0;
          break;
        case "margin":
          const marginA = parseFloat(a.price || 0) > 0 && parseFloat(a.cost || 0) > 0 
            ? ((parseFloat(a.price) - parseFloat(a.cost)) / parseFloat(a.price)) * 100 
            : 0;
          const marginB = parseFloat(b.price || 0) > 0 && parseFloat(b.cost || 0) > 0 
            ? ((parseFloat(b.price) - parseFloat(b.cost)) / parseFloat(b.price)) * 100 
            : 0;
          valueA = marginA;
          valueB = marginB;
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

  function resetOptimizer() {
    setOptimizedIngredients({});
    setOptimizedPrice(null);
  }

  function getIngredientCount(menuItem) {
    if (menuItem.menu_item_components && menuItem.menu_item_components.length > 0) {
      const uniqueIngredientIds = new Set();
      menuItem.menu_item_components.forEach(component => {
        component.component_ingredients?.forEach(ingredient => {
          if (ingredient.ingredients?.id) {
            uniqueIngredientIds.add(ingredient.ingredients.id);
          }
        });
      });
      return uniqueIngredientIds.size;
    } else {
      return menuItem.menu_item_ingredients?.length || 0;
    }
  }

  function hasIncompleteCosting(menuItem) {
    if (menuItem.menu_item_components && menuItem.menu_item_components.length > 0) {
      let hasMissingPrices = false;
      menuItem.menu_item_components.forEach(component => {
        component.component_ingredients?.forEach(ingredient => {
          if (!ingredient.ingredients?.last_price || parseFloat(ingredient.ingredients.last_price) === 0) {
            hasMissingPrices = true;
          }
        });
      });
      return hasMissingPrices;
    } else {
      if (!menuItem.menu_item_ingredients || menuItem.menu_item_ingredients.length === 0) {
        return true;
      }
      
      return menuItem.menu_item_ingredients.some(ingredient => 
        !ingredient.ingredients?.last_price || parseFloat(ingredient.ingredients.last_price) === 0
      );
    }
  }

  const filteredMenuItems = getFilteredAndSortedMenuItems();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Loading Menu Items</h3>
          <p className="text-gray-600">Fetching your menu data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <ClientLayout 
        pageTitle="Menu Items" 
        pageDescription="Error loading menu items"
        pageIcon={IconAlertTriangle}
      >
        <div className="p-6 text-center">
          <div className="flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mx-auto mb-6">
            <IconAlertTriangle size={32} className="text-red-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Error Loading Menu Items</h3>
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
      pageTitle="Menu Items" 
      pageDescription="Monitor menu item costs and profitability"
      pageIcon={IconChefHat}
    >
      {/* Header Section - All in one line */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Menu Engineering</h1>
          <p className="text-gray-600 text-sm mt-1">Optimize pricing and profitability</p>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Menu Item Search */}
          <MenuItemSearch 
            restaurantId={restaurantId}
            onMenuItemSelect={handleCardClick}
            placeholder="Search menu items by name..."
            className="w-96"
          />
          
          {/* Sort Control */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Sort:</span>
            <select 
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [field, direction] = e.target.value.split('-');
                setSortBy(field);
                setSortOrder(direction);
              }}
              className="border border-gray-300 rounded px-3 py-2 text-sm bg-white min-w-0"
            >
              <option value="name-asc">Name (A-Z)</option>
              <option value="name-desc">Name (Z-A)</option>
              <option value="price-desc">Price (High-Low)</option>
              <option value="price-asc">Price (Low-High)</option>
              <option value="cost-desc">Cost (High-Low)</option>
              <option value="cost-asc">Cost (Low-High)</option>
              <option value="margin-desc">Margin (High-Low)</option>
              <option value="margin-asc">Margin (Low-High)</option>
            </select>
          </div>
          
          {/* Add Menu Item Button */}
          <button
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <IconPlus size={16} />
            Add Item
          </button>
          
          {/* User Profile Circle */}
          <div 
            onClick={() => router.push('/client/profile')}
            className="flex items-center justify-center w-10 h-10 bg-blue-600 text-white rounded-full font-semibold text-sm cursor-pointer hover:bg-blue-700 transition-colors"
          >
            {getUserInitials(userName)}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className={`flex gap-6 transition-all duration-300`}>
        {/* Left Panel - Menu Items List */}
        <div className={`${selectedMenuItem ? 'w-1/2' : 'w-full'} transition-all duration-300`}>
          {/* Menu Items Cards */}
          <div className={`${selectedMenuItem ? 'overflow-y-auto h-[calc(100vh-140px)]' : ''}`}>
            {filteredMenuItems.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
                {searchTerm ? (
                  <>
                    <IconSearch size={48} className="mx-auto mb-4 text-gray-300" />
                    <h3 className="text-xl font-semibold text-gray-900 mb-4">No menu items found</h3>
                    <p className="text-gray-600 mb-6">No menu items match your search term "{searchTerm}"</p>
                    <button 
                      onClick={clearSearch} 
                      className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      <IconX size={18} />
                      Clear search
                    </button>
                  </>
                ) : menuItems.length === 0 ? (
                  <>
                    <IconChefHat size={48} className="mx-auto mb-4 text-gray-300" />
                    <h3 className="text-xl font-semibold text-gray-900 mb-4">No menu items yet</h3>
                    <p className="text-gray-600 mb-6">Menu items will appear here when they are added to your restaurant.</p>
                  </>
                ) : null}
              </div>
            ) : (
              <div className={`grid gap-6 ${selectedMenuItem ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
                {filteredMenuItems.map((item) => {
                  const marginColorClass = getMarginColor(item.price, item.cost);
                  const ingredientCount = getIngredientCount(item);
                  const hasIncompleteData = hasIncompleteCosting(item);
                  const margin = calculateMargin(item.price, item.cost);
                  const isSelected = selectedMenuItem === item.id;
                  
                  return (
                    <div 
                      key={item.id}
                      onClick={() => handleCardClick(item.id)}
                      className={`bg-white rounded-lg border shadow-sm p-4 cursor-pointer hover:shadow-md transition-all duration-200 group ${
                        isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-blue-200'
                      }`}
                    >
                      {/* Header with icon and status */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                            isSelected ? 'bg-blue-100' : 'bg-purple-100 group-hover:bg-purple-200'
                          }`}>
                            <IconChefHat size={16} className={isSelected ? 'text-blue-600' : 'text-purple-600'} />
                          </div>
                        </div>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          hasIncompleteData ? 'bg-red-100 text-red-800' : 
                          item.price && item.cost ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {hasIncompleteData ? "Incomplete" :
                           item.price && item.cost ? "Complete" : "Partial"}
                        </span>
                      </div>

                      {/* Menu Item Name */}
                      <div className="mb-3">
                        <h3 className={`font-semibold text-base mb-0.5 transition-colors ${
                          isSelected ? 'text-blue-600' : 'text-gray-900 group-hover:text-blue-600'
                        }`}>
                          {item.name || "Unnamed item"}
                        </h3>
                        <p className="text-xs text-gray-500">
                          {ingredientCount} ingredient{ingredientCount !== 1 ? 's' : ''}
                        </p>
                      </div>

                      {/* Price, Cost, Margin Grid */}
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <div className="text-xs font-medium text-gray-500 mb-0.5">PRICE</div>
                          <div className="text-sm font-bold text-gray-900">
                            {item.price ? formatCurrency(item.price) : <span className="text-gray-400 text-xs">Not set</span>}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-gray-500 mb-0.5">COST</div>
                          <div className="text-sm font-bold text-gray-900">
                            {item.cost ? formatCurrency(item.cost) : <span className="text-gray-400 text-xs">No data</span>}
                          </div>
                        </div>
                      </div>

                      {/* Margin */}
                      <div className="border-t border-gray-100 pt-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-500">PROFIT MARGIN</span>
                          <span className={`text-sm font-bold ${marginColorClass}`}>
                            {margin}
                          </span>
                        </div>
                      </div>

                      {/* Selection indicator */}
                      <div className={`mt-2 transition-opacity duration-200 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        <div className="text-xs text-blue-600 font-medium flex items-center gap-1">
                          {isSelected ? 'Selected' : 'Click to view details'}
                          <IconEye size={10} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Menu Item Details */}
        {selectedMenuItem && (
          <div className="w-1/2 flex flex-col">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col h-[calc(100vh-140px)]">
              {/* Detail Header */}
              <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <IconChefHat size={20} />
                    Menu Item Details
                  </h2>
                  <div className="flex items-center gap-4">
                    <div className="flex bg-gray-100 rounded-lg p-1">
                      <button
                        onClick={() => setViewMode('details')}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                          viewMode === 'details' 
                            ? 'bg-white text-gray-900 shadow-sm' 
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        View Details
                      </button>
                      <button
                        onClick={() => setViewMode('optimize')}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                          viewMode === 'optimize' 
                            ? 'bg-white text-gray-900 shadow-sm' 
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        Optimize Recipe
                      </button>
                    </div>
                    <button 
                      onClick={handleCloseDetail}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"
                    >
                      <IconX size={16} />
                      Close
                    </button>
                  </div>
                </div>
              </div>

              {/* Detail Content */}
              <div className="flex-1 overflow-y-auto">
                <div className="p-6">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
                        <div className="text-gray-600">Loading details...</div>
                      </div>
                    </div>
                  ) : detailError ? (
                    <div className="text-center py-12">
                      <div className="flex items-center justify-center w-12 h-12 bg-red-100 rounded-full mx-auto mb-4">
                        <IconAlertTriangle size={24} className="text-red-600" />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">Error Loading Details</h3>
                      <p className="text-gray-600">{detailError}</p>
                    </div>
                  ) : selectedMenuItemData ? (
                    <MenuItemDetailContent 
                      data={selectedMenuItemData}
                      formatCurrency={formatCurrency}
                      formatDate={(dateString) => {
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
                      }}
                      formatDateTime={(dateString) => {
                        if (!dateString) return "N/A";
                        try {
                          return new Date(dateString).toLocaleString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          });
                        } catch {
                          return "Invalid date";
                        }
                      }}
                      expandedComponents={expandedComponents}
                      setExpandedComponents={setExpandedComponents}
                      // Add these new props:
                      viewMode={viewMode}
                      optimizedIngredients={optimizedIngredients}
                      setOptimizedIngredients={setOptimizedIngredients}
                      optimizedPrice={optimizedPrice}
                      setOptimizedPrice={setOptimizedPrice}
                      resetOptimizer={resetOptimizer}
                      showInput={showInput}
                      setShowInput={setShowInput}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ClientLayout>
  );
}

// Separate component for menu item details
function MenuItemDetailContent({ 
  data, 
  formatCurrency, 
  formatDate, 
  formatDateTime, 
  expandedComponents, 
  setExpandedComponents,
  viewMode,
  optimizedIngredients,
  setOptimizedIngredients,
  optimizedPrice,
  setOptimizedPrice,
  resetOptimizer,
  showInput,
  setShowInput
}) {
  const { menuItem, ingredients, components, costHistory } = data;

  function calculateIngredientCost(ingredient, quantity) {
    const unitCost = parseFloat(ingredient?.last_price || 0);
    const qty = parseFloat(quantity || 0);
    return unitCost * qty;
  }

  function calculateTotalCost() {
    if (components.length > 0) {
      return components.reduce((total, component) => {
        return total + component.calculatedCost;
      }, 0);
    } else {
      return ingredients.reduce((total, item) => {
        return total + calculateIngredientCost(item.ingredients, item.quantity);
      }, 0);
    }
  }

  function toggleComponent(componentId) {
    setExpandedComponents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(componentId)) {
        newSet.delete(componentId);
      } else {
        newSet.add(componentId);
      }
      return newSet;
    });
  }

  function expandAll() {
    setExpandedComponents(new Set(components.map(c => c.id)));
  }

  function collapseAll() {
    setExpandedComponents(new Set());
  }

  function calculateProfitMargin() {
    const price = parseFloat(menuItem?.price || 0);
    const cost = calculateTotalCost();
    
    if (price === 0) return null;
    return ((price - cost) / price) * 100;
  }

  function getMarginColor(margin) {
    if (margin === null || margin === undefined) return "text-gray-400";
    if (margin >= 70) return "text-green-600 font-semibold";
    if (margin >= 50) return "text-green-500 font-medium";
    if (margin >= 30) return "text-yellow-600 font-medium";
    return "text-red-500 font-semibold";
  }

  function getUniqueIngredientCount() {
    if (components.length > 0) {
      const uniqueIngredientIds = new Set();
      components.forEach(component => {
        component.ingredients.forEach(ingredient => {
          if (ingredient.ingredientId) {
            uniqueIngredientIds.add(ingredient.ingredientId);
          }
        });
      });
      
      return uniqueIngredientIds.size;
    } else {
      return ingredients.length;
    }
  }

  function getMissingPriceIngredients() {
    let missingIngredients = [];
    
    if (components.length > 0) {
      components.forEach(component => {
        component.ingredients.forEach(ingredient => {
          if (!ingredient.hasPrice) {
            missingIngredients.push(ingredient);
          }
        });
      });
    } else {
      missingIngredients = ingredients.filter(item => 
        !item.ingredients?.last_price || parseFloat(item.ingredients.last_price) === 0
      );
    }
    
    return missingIngredients;
  }

  function getOptimizedComponentMultiplier(componentId) {
    return optimizedIngredients[componentId]?.multiplier ?? 1.0;
  }

  function updateComponentMultiplier(componentId, newMultiplier) {
    setOptimizedIngredients(prev => ({
      ...prev,
      [componentId]: { multiplier: Math.max(0, newMultiplier) }
    }));
  }

  function calculateOptimizedTotalCost() {
    if (components.length > 0) {
      return components.reduce((total, component) => {
        const multiplier = getOptimizedComponentMultiplier(component.id);
        return total + (component.calculatedCost * multiplier);
      }, 0);
    } else {
      return ingredients.reduce((total, item) => {
        const multiplier = getOptimizedComponentMultiplier('ingredients');
        return total + (calculateIngredientCost(item.ingredients, item.quantity) * multiplier);
      }, 0);
    }
  }

  function calculateOptimizedMargin() {
    const price = parseFloat((optimizedPrice ?? menuItem?.price) || 0);
    const cost = calculateOptimizedTotalCost();
    
    if (price === 0) return null;
    return ((price - cost) / price) * 100;
  }

  const totalCost = calculateTotalCost();
  const profitMargin = calculateProfitMargin();
  const marginColorClass = getMarginColor(profitMargin);
  const missingPriceIngredients = getMissingPriceIngredients();

  return (
  <div className="space-y-6">
    {viewMode === 'details' ? (
        <>
          {/* Menu Item Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">{menuItem.name}</h1>
            
            {/* Metrics Cards Row */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-2xl p-4 text-center">
                <div className="text-xs font-medium text-gray-600 mb-1">Menu Price</div>
                <div className="text-lg font-bold text-gray-900">
                  {menuItem.price ? formatCurrency(menuItem.price) : "Not set"}
                </div>
              </div>
              
              <div className="bg-gray-50 rounded-2xl p-4 text-center">
                <div className="text-xs font-medium text-gray-600 mb-1">Ingredients</div>
                <div className="text-lg font-bold text-gray-900">
                  {getUniqueIngredientCount()}
                </div>
              </div>
              
              <div className="bg-gray-50 rounded-2xl p-4 text-center">
                <div className="text-xs font-medium text-gray-600 mb-1">Total Cost</div>
                <div className="text-lg font-bold text-gray-900">
                  {formatCurrency(totalCost)}
                </div>
              </div>
              
              <div className="bg-gray-50 rounded-2xl p-4 text-center">
                <div className="text-xs font-medium text-gray-600 mb-1">Margin</div>
                <div className={`text-lg font-bold ${marginColorClass}`}>
                  {profitMargin !== null ? `${profitMargin.toFixed(1)}%` : "N/A"}
                </div>
              </div>
            </div>
          </div>

          {/* Component Breakdown */}
          {components.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <IconChefHat size={16} className="text-gray-600" />
                  <h3 className="text-sm font-semibold text-gray-900">Component Breakdown</h3>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{components.length} components</span>
                  <button onClick={expandAll} className="text-blue-600 hover:text-blue-700">Expand</button>
                  <button onClick={collapseAll} className="text-gray-600 hover:text-gray-700">Collapse</button>
                </div>
              </div>

              <div className="space-y-2">
                {components.map(component => {
                  const isExpanded = expandedComponents.has(component.id);
                  
                  return (
                    <div key={component.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      {/* Component Header */}
                      <div 
                        className="bg-white p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => toggleComponent(component.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-semibold text-gray-900">{component.name}</h4>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {component.ingredientCount} ingredients
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-gray-900">
                              {formatCurrency(component.calculatedCost)}
                            </div>
                            <div className="text-xs text-gray-500">
                              {totalCost > 0 ? ((component.calculatedCost / totalCost) * 100).toFixed(0) : 0}% of total
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Ingredients */}
                      {isExpanded && (
                        <div className="bg-gray-50 border-t border-gray-200 px-4 py-2">
                          {component.ingredients.map((ingredient) => (
                            <div key={ingredient.id} className="flex items-center justify-between py-2">
                              <div className="flex items-center gap-2">
                                <div className={`w-1.5 h-1.5 rounded-full ${ingredient.hasPrice ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                <span className="text-sm text-gray-900">{ingredient.name}</span>
                                <span className="text-xs text-gray-500">
                                  {ingredient.quantity} {ingredient.unit}
                                </span>
                              </div>
                              <div className="text-sm font-medium text-gray-900">
                                {formatCurrency(ingredient.totalCost)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Total Food Cost */}
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-gray-900">Total Food Cost</span>
                  <span className="text-xl font-bold text-gray-900">{formatCurrency(totalCost)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Pricing Recommendations */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <IconTrendingUp size={16} className="text-gray-600" />
              <h3 className="text-sm font-semibold text-gray-900">Pricing Recommendations</h3>
            </div>
            
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-2xl p-4 text-center">
                <div className="text-xs font-medium text-gray-600 mb-1">Break-even (30%)</div>
                <div className="text-lg font-bold text-gray-900">
                  {formatCurrency(totalCost / 0.30)}
                </div>
              </div>
              <div className="bg-green-50 rounded-2xl p-4 text-center">
                <div className="text-xs font-medium text-gray-600 mb-1">Recommended (25%)</div>
                <div className="text-lg font-bold text-green-700">
                  {formatCurrency(totalCost / 0.25)}
                </div>
              </div>
              <div className="bg-blue-50 rounded-2xl p-4 text-center">
                <div className="text-xs font-medium text-gray-600 mb-1">Premium (20%)</div>
                <div className="text-lg font-bold text-blue-700">
                  {formatCurrency(totalCost / 0.20)}
                </div>
              </div>
            </div>
          </div>

          {/* Cost Change History */}
          {costHistory.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <IconChartLine size={16} className="text-gray-600" />
                <h3 className="text-sm font-semibold text-gray-900">Cost Change History</h3>
              </div>
              
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="grid grid-cols-4 gap-4 p-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-600">
                  <div>Date</div>
                  <div>Previous</div>
                  <div>New</div>
                  <div>Change</div>
                </div>
                
                {costHistory.slice(0, 5).map((record) => {
                  const change = parseFloat(record.new_cost || 0) - parseFloat(record.old_cost || 0);
                  const isIncrease = change > 0;
                  
                  return (
                    <div key={record.id} className="grid grid-cols-4 gap-4 p-3 border-b border-gray-100 last:border-b-0 text-sm">
                      <div className="text-gray-600">
                        {formatDate(record.created_at)}
                      </div>
                      <div className="text-gray-900">
                        {formatCurrency(record.old_cost)}
                      </div>
                      <div className="text-gray-900">
                        {formatCurrency(record.new_cost)}
                      </div>
                      <div className={`font-medium ${isIncrease ? 'text-red-600' : 'text-green-600'}`}>
                        {isIncrease ? '+' : ''}{formatCurrency(change)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
      // NEW OPTIMIZER VIEW
      <>
        {/* Optimizer Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900">{menuItem.name}</h1>
          <button
            onClick={resetOptimizer}
            className="flex items-center gap-1 px-3 py-1 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-100 rounded-md transition-colors"
          >
            <IconRefresh size={14} />
            Reset
          </button>
        </div>

        {/* Comparison Cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <IconClipboardList size={16} />
              Original Recipe
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Cost:</span>
                <span className="font-medium">{formatCurrency(totalCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Price:</span>
                <span className="font-medium">{formatCurrency(menuItem.price)}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-gray-600">Margin:</span>
                <span className={`font-bold ${marginColorClass}`}>
                  {profitMargin !== null ? `${profitMargin.toFixed(1)}%` : "N/A"}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-blue-50 border border-green-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <IconTrendingUp size={16} />
              Optimized Recipe
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Cost:</span>
                <span className="font-medium">{formatCurrency(calculateOptimizedTotalCost())}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Price:</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={optimizedPrice ?? menuItem.price ?? ''}
                    onChange={(e) => setOptimizedPrice(parseFloat(e.target.value) || null)}
                    className="w-20 px-2 py-1 text-right border border-gray-300 rounded text-xs"
                  />
                </div>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-gray-600">Margin:</span>
                <span className={`font-bold ${getMarginColor(calculateOptimizedMargin())}`}>
                  {calculateOptimizedMargin() !== null ? `${calculateOptimizedMargin().toFixed(1)}%` : "N/A"}
                </span>
              </div>
            </div>
          </div>
        </div>

      {/* Interactive Components */}
      {components.length > 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <IconChefHat size={16} />
                  Adjust Component Portions
                </h3>
                <p className="text-xs text-gray-500 mt-1">Scale entire components up or down while maintaining ingredient ratios</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500">
                  {components.length} component{components.length !== 1 ? 's' : ''}
                </div>
                <div className="flex gap-1">
                  <button 
                    onClick={() => setExpandedComponents(new Set(components.map(c => c.id)))}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors"
                  >
                    <IconEye size={12} />
                    Expand
                  </button>
                  <button 
                    onClick={() => setExpandedComponents(new Set())}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors"
                  >
                    <IconEyeOff size={12} />
                    Collapse
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="p-4 space-y-3">
            {components.map(component => {
              const multiplier = getOptimizedComponentMultiplier(component.id);
              const originalCost = component.calculatedCost;
              const newCost = originalCost * multiplier;
              const costChange = newCost - originalCost;
              const isExpanded = expandedComponents.has(component.id);

              
              return (
                <div key={component.id} className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* Component Header - Clickable */}
                  <div 
                    className="bg-gray-50 px-3 py-2 cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => {
                      const newSet = new Set(expandedComponents);
                      if (newSet.has(component.id)) {
                        newSet.delete(component.id);
                      } else {
                        newSet.add(component.id);
                      }
                      setExpandedComponents(newSet);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="text-gray-400">
                          {isExpanded ? (
                            <IconChevronDown size={16} />
                          ) : (
                            <IconChevronRight size={16} />
                          )}
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900">{component.name}</h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-500">
                              {component.ingredientCount} ingredient{component.ingredientCount !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-gray-900">{formatCurrency(newCost)}</div>
                        {costChange !== 0 && (
                          <div className={`text-xs ${costChange > 0 ? 'text-red-500' : 'text-green-500'}`}>
                            {costChange > 0 ? '+' : ''}{formatCurrency(costChange)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Component Controls - Always Visible */}
                  <div className="bg-white p-4">
                    
                    <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                      <span className="text-xs font-medium text-gray-700 whitespace-nowrap">Portion Size:</span>
                      
                      <div className="flex-1 flex items-center gap-2 relative">
                        <span className="text-xs text-gray-400">0%</span>
                        
                        <div 
                          className="flex-1 relative"
                          onMouseEnter={() => setShowInput(component.id)}
                          onMouseLeave={() => setShowInput(null)}
                        >
                          <input
                            type="range"
                            min="0"
                            max="200"
                            step="1"
                            value={Math.round(multiplier * 100)}
                            onChange={(e) => updateComponentMultiplier(component.id, parseInt(e.target.value) / 100)}
                            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            style={{
                              background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(multiplier * 100 / 200) * 100}%, #e5e7eb ${(multiplier * 100 / 200) * 100}%, #e5e7eb 100%)`
                            }}
                          />
                          
                          {/* Hover textbox */}
                          {showInput === component.id && (
                            <div 
                              className="absolute -top-12 bg-white border border-gray-300 rounded shadow-lg px-2 py-1 z-10"
                              style={{
                                left: `${(multiplier * 100 / 200) * 100}%`,
                                transform: 'translateX(-50%)'
                              }}
                              onMouseEnter={() => setShowInput(component.id)}
                              onMouseLeave={() => setShowInput(null)}
                            >
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={multiplier === 0 ? '' : Math.round(multiplier * 100)}
                                  onChange={(e) => {
                                    const inputValue = e.target.value;
                                    
                                    if (inputValue === '' || inputValue === null || inputValue === undefined) {
                                      updateComponentMultiplier(component.id, 0);
                                      return;
                                    }
                                    
                                    let value = parseInt(inputValue);
                                    
                                    if (isNaN(value)) value = 0;
                                    if (value < 0) value = 0;
                                    if (value > 200) value = 200;
                                    
                                    updateComponentMultiplier(component.id, value / 100);
                                  }}
                                  onKeyPress={(e) => {
                                    if (!/[0-9]/.test(e.key) && !['Backspace', 'Delete', 'Enter', 'Tab'].includes(e.key)) {
                                      e.preventDefault();
                                    }
                                    
                                    if (e.key === 'Enter') {
                                      e.target.blur();
                                      setShowInput(null);
                                    }
                                  }}
                                  onBlur={() => setShowInput(null)}
                                  onFocus={(e) => e.target.select()}
                                  onClick={(e) => e.target.select()}
                                  autoFocus
                                  className="w-12 px-1 py-0.5 text-center border-0 text-xs font-medium focus:outline-none"
                                />
                                <span className="text-xs text-gray-600">%</span>
                              </div>
                              {/* Small arrow pointing down */}
                              <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-white"></div>
                            </div>
                          )}
                        </div>
                        
                        <span className="text-xs text-gray-400">200%</span>
                      </div>
                    </div>
                    
                    {/* Show scaled ingredients - Only when expanded */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="text-xs font-medium text-gray-700 mb-2">Scaled Ingredients:</div>
                      <div className="space-y-1">
                        {component.ingredients.map((ingredient, ingredientIndex) => {
                          const isLast = ingredientIndex === component.ingredients.length - 1;
                          const scaledQuantity = ingredient.quantity * multiplier;
                          const scaledCost = ingredient.totalCost * multiplier;
                          
                          return (
                            <div key={ingredient.id} className="relative">
                              {/* Tree structure lines */}
                              <div className="absolute left-2 top-0 w-px bg-gray-300" style={{
                                height: isLast ? '8px' : '100%'
                              }}></div>
                              <div className="absolute left-2 top-2 w-3 h-px bg-gray-300"></div>
                              
                              <div className="flex items-center justify-between py-1 pl-6 pr-2">
                                <div className="flex-1">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <span className="text-xs font-medium text-gray-900">{ingredient.name}</span>
                                      <div className="text-xs text-gray-500">
                                        {scaledQuantity.toFixed(1)} {ingredient.unit}
                                        {multiplier !== 1.0 && (
                                          <span className="ml-1 text-blue-600">
                                            (was {ingredient.quantity} {ingredient.unit})
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="text-right ml-2">
                                      <div className="text-xs font-semibold text-gray-900">
                                        ${scaledCost.toFixed(3)}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        {ingredient.hasPrice ? (
                                          `${ingredient.unitCost.toFixed(3)}/${ingredient.standardUnit}`
                                        ) : (
                                          'No price'
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="ml-2">
                                  {ingredient.hasPrice ? (
                                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                                  ) : (
                                    <div className="w-1.5 h-1.5 bg-red-500 rounded-full"></div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        ) : ingredients.length > 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <IconChefHat size={16} />
                Adjust Recipe Portion
              </h3>
              <p className="text-xs text-gray-500 mt-1">Scale the entire recipe up or down</p>
            </div>
            <div className="p-4">
              {(() => {
                const multiplier = getOptimizedComponentMultiplier('ingredients');
                const originalCost = ingredients.reduce((total, item) => {
                  return total + calculateIngredientCost(item.ingredients, item.quantity);
                }, 0);
                const newCost = originalCost * multiplier;
                const costChange = newCost - originalCost;
                
                return (
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-semibold text-gray-900">Recipe Portion</h4>
                        <p className="text-xs text-gray-500">{ingredients.length} ingredients</p>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-gray-900">{formatCurrency(newCost)}</div>
                        {costChange !== 0 && (
                          <div className={`text-xs ${costChange > 0 ? 'text-red-500' : 'text-green-500'}`}>
                            {costChange > 0 ? '+' : ''}{formatCurrency(costChange)}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-gray-700">Portion Size:</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max="200"
                            value={Math.round(multiplier * 100)}
                            onChange={(e) => {
                              const percentage = parseInt(e.target.value) || 0;
                              updateComponentMultiplier(component.id, percentage / 100);
                            }}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                e.target.blur();
                              }
                            }}
                            className="w-16 px-2 py-1 text-center border border-gray-300 rounded text-sm font-medium"
                          />
                          <span className="text-sm text-gray-600">%</span>
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <input
                          type="range"
                          min="0"
                          max="200"
                          step="1"
                          value={Math.round(multiplier * 100)}
                          onChange={(e) => updateComponentMultiplier(component.id, parseInt(e.target.value) / 100)}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                          style={{
                            background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(multiplier * 100 / 200) * 100}%, #e5e7eb ${(multiplier * 100 / 200) * 100}%, #e5e7eb 100%)`
                          }}
                        />
                        
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>0%</span>
                          <span>100%</span>
                          <span>200%</span>
                        </div>
                      </div>
                      
                      <div className="mt-2 text-center">
                        <div className="text-xs text-gray-600">
                          {multiplier < 1.0 ? `${((1 - multiplier) * 100).toFixed(0)}% smaller portion` :
                          multiplier > 1.0 ? `${((multiplier - 1) * 100).toFixed(0)}% larger portion` :
                          'Standard portion size'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        ) : null}
        </>
   )}
 </div>
 );
}