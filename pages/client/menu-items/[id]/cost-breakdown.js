// pages/client/menu-items/[id]/cost-breakdown.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import ClientLayout from '../../../../components/ClientLayout';
import supabase from '../../../../lib/supabaseClient';
import { calculateStandardizedCost } from '/lib/standardizedUnits';
import {
  IconArrowLeft,
  IconCurrencyDollar,
  IconChevronRight,
  IconChevronDown,
  IconAlertTriangle,
  IconChefHat,
  IconClipboardList,
  IconTrendingUp,
  IconEye,
  IconEyeOff,
  IconCheck,
  IconX,
  IconExclamationCircle,
} from "@tabler/icons-react";

export default function MenuItemCostBreakdown() {
  const router = useRouter();
  const { id } = router.query;
  const [menuItem, setMenuItem] = useState(null);
  const [components, setComponents] = useState([]);
  const [expandedComponents, setExpandedComponents] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (id) {
      fetchMenuItemCostBreakdown();
    }
  }, [id]);

  async function fetchMenuItemCostBreakdown() {
    try {
      console.log('🔍 Fetching cost breakdown for menu item:', id);

      // Get menu item details
      const { data: menuItemData, error: menuItemError } = await supabase
        .from('menu_items')
        .select('*')
        .eq('id', id)
        .single();

      if (menuItemError) {
        console.error('❌ Menu item error:', menuItemError);
        throw menuItemError;
      }
      
      console.log('✅ Menu item data:', menuItemData);
      setMenuItem(menuItemData);

      // First, let's check if there are any components at all
      const { data: simpleComponentsData, error: simpleComponentsError } = await supabase
        .from('menu_item_components')
        .select('*')
        .eq('menu_item_id', id);

      console.log('🧩 Simple components query result:', { simpleComponentsData, simpleComponentsError });

      if (simpleComponentsError) {
        console.error('❌ Simple components error:', simpleComponentsError);
        throw simpleComponentsError;
      }

      if (!simpleComponentsData || simpleComponentsData.length === 0) {
        console.log('⚠️ No components found for menu item:', id);
        setComponents([]);
        return;
      }

      // Get components with their ingredients
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
        .eq('menu_item_id', id)
        .order('name');

      console.log('🧩 Full components query result:', { componentsData, componentsError });

      if (componentsError) {
        console.error('❌ Components error:', componentsError);
        throw componentsError;
      }

      // Process components with calculated costs
      const processedComponents = (componentsData || []).map(component => {
        console.log('🔄 Processing component:', component);
        
        const processedIngredients = (component.component_ingredients || []).map(ing => {
          console.log('🥕 Processing ingredient:', ing);
          
          const ingredient = ing.ingredients;
          const recipeQuantity = ing.quantity;
          const recipeUnit = ing.unit;
          const ingredientCost = ingredient?.last_price || 0;
          const ingredientName = ingredient?.name || 'Unknown';

          let calculatedCost = 0;
          if (ingredientCost > 0) {
            try {
              // Fallback if calculateStandardizedCost is not available
              if (typeof calculateStandardizedCost === 'function') {
                calculatedCost = calculateStandardizedCost(
                  recipeQuantity,
                  recipeUnit,
                  ingredientCost,
                  ingredientName
                );
              } else {
                console.warn('⚠️ calculateStandardizedCost function not available, using simple calculation');
                calculatedCost = recipeQuantity * ingredientCost;
              }
            } catch (error) {
              console.warn(`Cost calculation failed for ${ingredientName}:`, error);
              calculatedCost = recipeQuantity * ingredientCost;
            }
          }

          return {
            id: ing.id,
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

        // Calculate component total (should match stored cost)
        const calculatedTotal = processedIngredients.reduce((sum, ing) => sum + ing.totalCost, 0);

        const processedComponent = {
          id: component.id,
          name: component.name,
          storedCost: component.cost || 0,
          calculatedCost: calculatedTotal,
          ingredients: processedIngredients,
          ingredientCount: processedIngredients.length
        };
        
        console.log('✅ Processed component:', processedComponent);
        return processedComponent;
      });

      console.log('🎯 Final processed components:', processedComponents);
      setComponents(processedComponents);
      console.log('✅ Cost breakdown loaded successfully');

    } catch (error) {
      console.error('❌ Error fetching cost breakdown:', error);
      setError(error.message);
    } finally {
      setLoading(false);
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

  if (loading) {
    return (
      <ClientLayout 
        pageTitle="Cost Breakdown" 
        pageDescription="Loading cost breakdown..."
        pageIcon={IconClipboardList}
      >
        <div className="p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
            <div className="text-gray-600">Loading cost breakdown...</div>
          </div>
        </div>
      </ClientLayout>
    );
  }

  if (error) {
    return (
      <ClientLayout 
        pageTitle="Cost Breakdown" 
        pageDescription="Error loading cost breakdown"
        pageIcon={IconAlertTriangle}
      >
        <div className="p-6 text-center">
          <div className="flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mx-auto mb-6">
            <IconAlertTriangle size={32} className="text-red-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Failed to Load Cost Breakdown</h3>
          <p className="text-gray-600 mb-6">{error}</p>
          <button 
            onClick={() => router.back()} 
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
          >
            <IconArrowLeft size={18} />
            Go Back
          </button>
        </div>
      </ClientLayout>
    );
  }

  if (!menuItem) {
    return (
      <ClientLayout 
        pageTitle="Cost Breakdown" 
        pageDescription="Menu item not found"
        pageIcon={IconChefHat}
      >
        <div className="p-6 text-center">
          <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6">
            <IconChefHat size={32} className="text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Menu Item Not Found</h3>
          <button 
            onClick={() => router.back()} 
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
          >
            <IconArrowLeft size={18} />
            Go Back
          </button>
        </div>
      </ClientLayout>
    );
  }

  const totalCalculatedCost = components.reduce((sum, comp) => sum + comp.calculatedCost, 0);
  const margin = menuItem.price > 0 ? ((menuItem.price - totalCalculatedCost) / menuItem.price * 100) : 0;
  const foodCostPercent = menuItem.price > 0 ? (totalCalculatedCost / menuItem.price * 100) : 0;

  function getFoodCostColor(percent) {
    if (percent < 25) return "text-green-600";
    if (percent < 35) return "text-yellow-600";
    return "text-red-600";
  }

  function getMarginColor(margin) {
    if (margin > 70) return "text-green-600";
    if (margin > 60) return "text-yellow-600";
    return "text-red-600";
  }

  return (
    <ClientLayout 
      pageTitle={`Cost Breakdown - ${menuItem.name}`} 
      pageDescription="Detailed ingredient cost analysis"
      pageIcon={IconClipboardList}
    >
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => router.back()} 
              className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <IconArrowLeft size={18} />
              Back
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">💰 Cost Breakdown</h1>
              <p className="text-gray-600">{menuItem.name}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 space-y-6">
        {/* Summary Card */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <IconCurrencyDollar size={20} />
                Cost Summary
              </h2>
              <div className="flex gap-2">
                <button 
                  onClick={expandAll}
                  className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <IconEye size={16} />
                  Expand All
                </button>
                <button 
                  onClick={collapseAll}
                  className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <IconEyeOff size={16} />
                  Collapse All
                </button>
              </div>
            </div>
          </div>
          
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="text-center">
                <div className="text-sm text-gray-500 mb-1">Menu Price</div>
                <div className="text-2xl font-bold text-gray-900">${menuItem.price.toFixed(2)}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-500 mb-1">Total Food Cost</div>
                <div className="text-2xl font-bold text-gray-900">${totalCalculatedCost.toFixed(4)}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-500 mb-1">Food Cost %</div>
                <div className={`text-2xl font-bold ${getFoodCostColor(foodCostPercent)}`}>
                  {foodCostPercent.toFixed(1)}%
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-500 mb-1">Profit Margin</div>
                <div className={`text-2xl font-bold ${getMarginColor(margin)}`}>
                  {margin.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Components Breakdown */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <IconChefHat size={20} />
                Component Breakdown
              </h2>
              <div className="text-sm text-gray-500">
                {components.length} component{components.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {components.length === 0 ? (
            <div className="p-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6">
                <IconChefHat size={32} className="text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">No Components Found</h3>
              <p className="text-gray-600">This menu item doesn't have any components configured yet.</p>
              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Debug Info:</strong> Menu Item ID: {id}
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Check the browser console for more detailed debugging information.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
            {components.map(component => {
              const isExpanded = expandedComponents.has(component.id);
              const costDiscrepancy = Math.abs(component.storedCost - component.calculatedCost);
              const hasDiscrepancy = costDiscrepancy > 0.01;

              return (
                <div key={component.id}>
                  {/* Component Header */}
                  <div 
                    className="px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => toggleComponent(component.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button className="text-gray-400 hover:text-gray-600">
                          {isExpanded ? (
                            <IconChevronDown size={20} />
                          ) : (
                            <IconChevronRight size={20} />
                          )}
                        </button>
                        <div>
                          <h3 className="text-lg font-medium text-gray-900">{component.name}</h3>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-sm text-gray-500">
                              {component.ingredientCount} ingredient{component.ingredientCount !== 1 ? 's' : ''}
                            </span>
                            {hasDiscrepancy && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                <IconExclamationCircle size={12} />
                                Cost mismatch
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold text-gray-900">
                          ${component.calculatedCost.toFixed(4)}
                        </div>
                        <div className="text-sm text-gray-500">
                          {totalCalculatedCost > 0 ? 
                            ((component.calculatedCost / totalCalculatedCost) * 100).toFixed(1) : 0
                          }%
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Ingredients */}
                  {isExpanded && (
                    <div className="px-6 pb-4 bg-gray-50">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-left py-3 text-sm font-semibold text-gray-900">Ingredient</th>
                              <th className="text-left py-3 text-sm font-semibold text-gray-900">Recipe Amount</th>
                              <th className="text-left py-3 text-sm font-semibold text-gray-900">Unit Cost</th>
                              <th className="text-left py-3 text-sm font-semibold text-gray-900">Total Cost</th>
                              <th className="text-left py-3 text-sm font-semibold text-gray-900">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {component.ingredients.map(ingredient => (
                              <tr key={ingredient.id} className="hover:bg-white">
                                <td className="py-3">
                                  <div>
                                    <div className="font-medium text-gray-900">{ingredient.name}</div>
                                    {ingredient.lastOrdered && (
                                      <div className="text-xs text-gray-500">
                                        Last ordered: {formatDate(ingredient.lastOrdered)}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 text-gray-900">
                                  {ingredient.quantity} {ingredient.unit}
                                </td>
                                <td className="py-3">
                                  {ingredient.hasPrice ? (
                                    <div>
                                      <div className="font-medium text-gray-900">
                                        ${ingredient.unitCost.toFixed(4)}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        per {ingredient.standardUnit}
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-red-500 italic">No price data</span>
                                  )}
                                </td>
                                <td className="py-3 font-medium text-gray-900">
                                  ${ingredient.totalCost.toFixed(4)}
                                </td>
                                <td className="py-3">
                                  {ingredient.hasPrice ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                      <IconCheck size={12} />
                                      Priced
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                      <IconX size={12} />
                                      No price
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-gray-300 bg-white">
                              <td colSpan="3" className="py-3 font-semibold text-gray-900">Component Total:</td>
                              <td className="py-3 font-bold text-gray-900">
                                ${component.calculatedCost.toFixed(4)}
                              </td>
                              <td></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </div>

        {/* Cost Analysis */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <IconTrendingUp size={20} />
              Cost Analysis
            </h3>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Break-even price (30% food cost):</span>
                <span className="font-semibold text-gray-900">
                  ${(totalCalculatedCost / 0.30).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Recommended price (25% food cost):</span>
                <span className="font-semibold text-green-600">
                  ${(totalCalculatedCost / 0.25).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Premium price (20% food cost):</span>
                <span className="font-semibold text-blue-600">
                  ${(totalCalculatedCost / 0.20).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ClientLayout>
  );
}