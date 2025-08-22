// pages/admin/menu-items.js (Updated to use AdminLayout)
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import { 
  calculateStandardizedCost, 
  getUnitSuggestions, 
  validateUnit,
  getStandardUnitForUnit,
  getUnitCategory,
  normalizeUnit
} from '../../lib/standardizedUnits';
import {
  IconX,
  IconPlus,
  IconPencil,
  IconTrash,
  IconEye,
  IconCheck,
  IconBuilding,
  IconChevronLeft,
  IconSearch,
  IconCurrencyDollar,
  IconPercentage,
  IconRefresh,
} from '@tabler/icons-react';

export default function MenuItemsManagement() {
  const router = useRouter();
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [menuItems, setMenuItems] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    price: ''
  });
  const [menuItemComponents, setMenuItemComponents] = useState([]);
  const [filteredIngredients, setFilteredIngredients] = useState([]);
  const [activeSearchComponentIndex, setActiveSearchComponentIndex] = useState(null);
  const [activeSearchIngredientIndex, setActiveSearchIngredientIndex] = useState(null);
  const [unitSuggestions, setUnitSuggestions] = useState([]);
  const [activeUnitComponentIndex, setActiveUnitComponentIndex] = useState(null);
  const [activeUnitIngredientIndex, setActiveUnitIngredientIndex] = useState(null);
  const [highlightedUnitIndex, setHighlightedUnitIndex] = useState(-1);
  const [saving, setSaving] = useState(false);

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
      fetchMenuItems();
      fetchIngredients();
    }
  }, [selectedRestaurant]);

  // ... (all your existing functions remain the same)
  async function fetchRestaurants() {
    try {
      const { data, error } = await supabase
        .from('restaurants')
        .select('*')
        .order('name');

      if (error) throw error;
      setRestaurants(data || []);
    } catch (error) {
      console.error('Error fetching restaurants:', error);
    } finally {
      setLoading(false);
    }
  }

  // ... (include all your other existing functions here - fetchMenuItems, fetchIngredients, handleSubmit, etc.)

  if (loading) {
    return (
      <AdminLayout 
        pageTitle="Menu Items Management" 
        pageDescription="Manage menu items and their components"
        pageIcon={IconSearch}
      >
        <div className="p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
            <div className="text-gray-600">Loading restaurants...</div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout 
      pageTitle="Menu Items Management" 
      pageDescription="Manage menu items and their components"
      pageIcon={IconSearch}
    >
      <div className="p-6">
        {!selectedRestaurant ? (
          /* Restaurant Selection */
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Select a Restaurant</h2>
              <p className="text-lg text-gray-600">Choose a restaurant to manage its menu items</p>
            </div>
            
            {restaurants.length === 0 ? (
              <div className="text-center py-12">
                <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6">
                  <IconBuilding size={32} className="text-gray-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-4">No restaurants found</h3>
                <p className="text-gray-600 mb-6">There are no restaurants set up yet.</p>
                <button 
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
                  onClick={() => router.push('/admin/clients')}
                >
                  <IconPlus size={18} />
                  Add Restaurant
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {restaurants.map(restaurant => (
                  <button
                    key={restaurant.id}
                    className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 text-left group"
                    onClick={() => setSelectedRestaurant(restaurant)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex items-center justify-center w-12 h-12 bg-[#ADD8E6] rounded-lg group-hover:bg-[#9CC5D4] transition-colors">
                        <IconBuilding size={24} className="text-gray-900" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900 mb-1">{restaurant.name}</h3>
                        <p className="text-sm text-gray-500">Manage menu items</p>
                      </div>
                      <div className="text-gray-400 group-hover:text-gray-600 transition-colors">
                        <IconChevronLeft size={20} className="rotate-180" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Menu Items Management */
          <div className="space-y-6">
            {/* Restaurant Header */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 bg-[#ADD8E6] rounded-lg">
                    <IconBuilding size={24} className="text-gray-900" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">{selectedRestaurant.name}</h2>
                    <p className="text-gray-600">Manage menu items and their components</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    onClick={() => setSelectedRestaurant(null)}
                  >
                    <IconChevronLeft size={18} />
                    Change Restaurant
                  </button>
                  <button 
                    className="flex items-center gap-2 px-4 py-2 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
                    onClick={() => setShowAddForm(true)}
                  >
                    <IconPlus size={18} />
                    Add Menu Item
                  </button>
                </div>
              </div>
            </div>

            {/* Rest of your content here - forms, tables, etc. */}
            {/* ... (include all your existing JSX for forms and tables) */}
            
            {/* Placeholder for the rest of your content */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
              <p className="text-gray-600">Menu items management interface goes here...</p>
              {/* Include all your existing form and table JSX */}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}