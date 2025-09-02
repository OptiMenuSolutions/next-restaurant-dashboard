// pages/admin/menu-items.js (Complete version with dynamic categories)
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
  const [categories, setCategories] = useState([]);
  const [creatingCategory, setCreatingCategory] = useState(false);
  
  // Restaurant selection state
  const [restaurantSearchTerm, setRestaurantSearchTerm] = useState('');
  const [filteredRestaurants, setFilteredRestaurants] = useState([]);
  const [highlightedRestaurantIndex, setHighlightedRestaurantIndex] = useState(-1);
  const [selectedRestaurantForConfirm, setSelectedRestaurantForConfirm] = useState(null);
  const [confirmationText, setConfirmationText] = useState('');
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    category_id: null,
    categorySearchTerm: ''
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
  
  // Category autocomplete state
  const [filteredCategories, setFilteredCategories] = useState([]);
  const [highlightedCategoryIndex, setHighlightedCategoryIndex] = useState(-1);

  const fetchCategories = useCallback(async () => {
    if (!selectedRestaurant) return;
    
    try {
      const { data, error } = await supabase
        .from('menu_categories')
        .select('*')
        .eq('restaurant_id', selectedRestaurant.id)
        .order('name');

      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  }, [selectedRestaurant?.id]);

  // Define callback functions first
  const fetchMenuItems = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('menu_items')
        .select(`
          *,
          menu_item_components (
            id,
            name,
            cost
          ),
          menu_categories (
            id,
            name
          )
        `)
        .eq('restaurant_id', selectedRestaurant.id)
        .order('name');

      if (error) throw error;
      setMenuItems(data || []);
    } catch (error) {
      console.error('Error fetching menu items:', error);
    }
  }, [selectedRestaurant?.id]);

  const fetchIngredients = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('ingredients')
        .select('*')
        .eq('restaurant_id', selectedRestaurant.id)
        .order('name');

      if (error) throw error;
      setIngredients(data || []);
    } catch (error) {
      console.error('Error fetching ingredients:', error);
    }
  }, [selectedRestaurant?.id]);

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
      fetchCategories();
    }
  }, [selectedRestaurant, fetchMenuItems, fetchIngredients, fetchCategories]);

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

  function handleRestaurantSelect(restaurant) {
    setSelectedRestaurant(restaurant);
    setShowAddForm(false);
    setEditingItem(null);
  }

  // Restaurant search functions
  function handleRestaurantSearch(searchTerm) {
    setRestaurantSearchTerm(searchTerm);
    setSelectedRestaurantForConfirm(null);
    setConfirmationText('');
    
    if (searchTerm.length > 0) {
      const filtered = restaurants.filter(restaurant =>
        restaurant.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredRestaurants(filtered);
      setHighlightedRestaurantIndex(filtered.length > 0 ? 0 : -1);
    } else {
      setFilteredRestaurants([]);
      setHighlightedRestaurantIndex(-1);
    }
  }

  function selectRestaurantForConfirm(restaurant) {
    setSelectedRestaurantForConfirm(restaurant);
    setRestaurantSearchTerm(restaurant.name);
    setFilteredRestaurants([]);
    setHighlightedRestaurantIndex(-1);
    setConfirmationText('');
  }

  function handleRestaurantKeyDown(e) {
    if (filteredRestaurants.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedRestaurantIndex(prev => 
        prev < filteredRestaurants.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedRestaurantIndex(prev => 
        prev > 0 ? prev - 1 : filteredRestaurants.length - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedRestaurantIndex >= 0 && highlightedRestaurantIndex < filteredRestaurants.length) {
        selectRestaurantForConfirm(filteredRestaurants[highlightedRestaurantIndex]);
      }
    } else if (e.key === 'Escape') {
      setFilteredRestaurants([]);
      setHighlightedRestaurantIndex(-1);
    }
  }

  function handleConfirmRestaurant() {
    if (!selectedRestaurantForConfirm) {
      alert('Please select a restaurant first');
      return;
    }
    
    if (confirmationText.trim() !== selectedRestaurantForConfirm.name) {
      alert(`Please type the restaurant name exactly: "${selectedRestaurantForConfirm.name}"`);
      return;
    }
    
    handleRestaurantSelect(selectedRestaurantForConfirm);
  }

  function handleFormChange(e) {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  }

  // Category autocomplete functions
  function handleCategorySearch(searchTerm) {
    setFormData(prev => ({
      ...prev,
      categorySearchTerm: searchTerm,
      category_id: null // Clear selected category when typing
    }));
    
    if (searchTerm.length > 0) {
      const filtered = categories.filter(category =>
        category.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredCategories(filtered);
      setHighlightedCategoryIndex(filtered.length > 0 ? 0 : -1);
    } else {
      setFilteredCategories([]);
      setHighlightedCategoryIndex(-1);
    }
  }

  function selectCategory(category) {
    setFormData(prev => ({
      ...prev,
      category_id: category.id,
      categorySearchTerm: category.name
    }));
    setFilteredCategories([]);
    setHighlightedCategoryIndex(-1);
  }

  async function handleCategoryKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedCategoryIndex(prev => 
        prev < filteredCategories.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedCategoryIndex(prev => 
        prev > 0 ? prev - 1 : filteredCategories.length - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      
      const searchTerm = formData.categorySearchTerm?.trim();
      if (!searchTerm) return;

      // Check if we have a highlighted category in the dropdown
      if (highlightedCategoryIndex >= 0 && highlightedCategoryIndex < filteredCategories.length) {
        selectCategory(filteredCategories[highlightedCategoryIndex]);
        return;
      }

      // Check if category already exists (case-insensitive)
      const existingCategory = categories.find(cat => 
        cat.name.toLowerCase() === searchTerm.toLowerCase()
      );

      if (existingCategory) {
        selectCategory(existingCategory);
        return;
      }

      // Create new category
      try {
        setCreatingCategory(true);
        
        const { data: newCategory, error } = await supabase
          .from('menu_categories')
          .insert({
            restaurant_id: selectedRestaurant.id,
            name: searchTerm
          })
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            alert('A category with this name already exists');
            return;
          }
          throw error;
        }

        // Add to local state and select it
        setCategories(prev => [...prev, newCategory].sort((a, b) => a.name.localeCompare(b.name)));
        setFormData(prev => ({
          ...prev,
          category_id: newCategory.id,
          categorySearchTerm: newCategory.name
        }));
        setFilteredCategories([]);
        setHighlightedCategoryIndex(-1);
        
      } catch (error) {
        console.error('Error creating category:', error);
        alert('Failed to create category: ' + error.message);
      } finally {
        setCreatingCategory(false);
      }
    } else if (e.key === 'Escape') {
      setFilteredCategories([]);
      setHighlightedCategoryIndex(-1);
    }
  }

  // Component management functions
  function addComponentRow() {
    const newComponent = {
      id: `component-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: '',
      ingredients: [],
      isNew: true
    };
    setMenuItemComponents(prev => [...prev, newComponent]);
  }

  function removeComponentRow(index) {
    setMenuItemComponents(prev => prev.filter((_, i) => i !== index));
  }

  function handleComponentChange(index, field, value) {
    setMenuItemComponents(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }

  // Ingredient management functions within components
  function addIngredientToComponent(componentIndex) {
    const newIngredient = {
      id: `ingredient-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ingredient_id: null,
      ingredient_search: '',
      quantity: '',
      unit: '',
      isNew: true
    };
    
    setMenuItemComponents(prev => {
      const updated = prev.map((comp, index) => {
        if (index === componentIndex) {
          return {
            ...comp,
            ingredients: [...(comp.ingredients || []), newIngredient]
          };
        }
        return comp;
      });
      return updated;
    });
  }

  function removeIngredientFromComponent(componentIndex, ingredientIndex) {
    setMenuItemComponents(prev => {
      const updated = prev.map((comp, index) => {
        if (index === componentIndex) {
          return {
            ...comp,
            ingredients: comp.ingredients.filter((_, i) => i !== ingredientIndex)
          };
        }
        return comp;
      });
      return updated;
    });
  }

  function handleIngredientChange(componentIndex, ingredientIndex, field, value) {
    setMenuItemComponents(prev => {
      const updated = [...prev];
      updated[componentIndex].ingredients[ingredientIndex] = {
        ...updated[componentIndex].ingredients[ingredientIndex],
        [field]: value
      };
      return updated;
    });
  }

  function handleIngredientSearch(componentIndex, ingredientIndex, searchTerm) {
    handleIngredientChange(componentIndex, ingredientIndex, 'ingredient_search', searchTerm);
    setActiveSearchComponentIndex(componentIndex);
    setActiveSearchIngredientIndex(ingredientIndex);
    
    if (searchTerm.length > 1) {
      const filtered = ingredients.filter(ingredient =>
        ingredient.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredIngredients(filtered);
    } else {
      setFilteredIngredients([]);
      setActiveSearchComponentIndex(null);
      setActiveSearchIngredientIndex(null);
    }
  }

  function selectIngredient(componentIndex, ingredientIndex, ingredient) {
    handleIngredientChange(componentIndex, ingredientIndex, 'ingredient_id', ingredient.id);
    handleIngredientChange(componentIndex, ingredientIndex, 'ingredient_search', ingredient.name);
    setFilteredIngredients([]);
    setActiveSearchComponentIndex(null);
    setActiveSearchIngredientIndex(null);
  }

  function handleUnitSearch(componentIndex, ingredientIndex, searchTerm) {
    handleIngredientChange(componentIndex, ingredientIndex, 'unit', searchTerm);
    setActiveUnitComponentIndex(componentIndex);
    setActiveUnitIngredientIndex(ingredientIndex);
    
    if (searchTerm.length > 0) {
      const suggestions = getUnitSuggestions(searchTerm, 8);
      setUnitSuggestions(suggestions);
      setHighlightedUnitIndex(suggestions.length > 0 ? 0 : -1);
    } else {
      setUnitSuggestions([]);
      setHighlightedUnitIndex(-1);
    }
  }

  function selectUnit(componentIndex, ingredientIndex, unitData) {
    const unit = typeof unitData === 'string' ? unitData : unitData.unit;
    handleIngredientChange(componentIndex, ingredientIndex, 'unit', unit);
    setUnitSuggestions([]);
    setActiveUnitComponentIndex(null);
    setActiveUnitIngredientIndex(null);
    setHighlightedUnitIndex(-1);
  }

  function handleUnitKeyDown(e, componentIndex, ingredientIndex) {
    if (unitSuggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedUnitIndex(prev => 
          prev < unitSuggestions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedUnitIndex(prev => 
          prev > 0 ? prev - 1 : unitSuggestions.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedUnitIndex >= 0 && highlightedUnitIndex < unitSuggestions.length) {
          selectUnit(componentIndex, ingredientIndex, unitSuggestions[highlightedUnitIndex]);
        }
        break;
      case 'Escape':
        setUnitSuggestions([]);
        setHighlightedUnitIndex(-1);
        break;
      default:
        break;
    }
  }

  function startAddItem() {
    setFormData({ name: '', price: '', category_id: null, categorySearchTerm: '' });
    setMenuItemComponents([]);
    setShowAddForm(true);
    setEditingItem(null);
    setFilteredCategories([]);
    setHighlightedCategoryIndex(-1);
  }

  async function startEditItem(item) {
    // Find the category name for the selected category_id
    const selectedCategory = categories.find(cat => cat.id === item.category_id);
    
    setFormData({
      name: item.name,
      price: item.price.toString(),
      category_id: item.category_id || null,
      categorySearchTerm: selectedCategory?.name || ''
    });

    // Fetch existing components and their ingredients for this menu item
    try {
      const { data: existingComponents, error } = await supabase
        .from('menu_item_components')
        .select(`
          *,
          component_ingredients (
            *,
            ingredients:ingredient_id (
              id,
              name,
              unit
            )
          )
        `)
        .eq('menu_item_id', item.id);

      if (error) throw error;

      const formattedComponents = existingComponents.map(comp => ({
        id: comp.id,
        name: comp.name,
        isNew: false,
        ingredients: comp.component_ingredients.map(ing => ({
          id: ing.id,
          ingredient_id: ing.ingredient_id,
          ingredient_search: ing.ingredients?.name || '',
          quantity: ing.quantity.toString(),
          unit: ing.unit || 'each',
          isNew: false
        }))
      }));

      setMenuItemComponents(formattedComponents);
    } catch (error) {
      console.error('Error fetching menu item components:', error);
      setMenuItemComponents([]);
    }

    setEditingItem(item);
    setShowAddForm(true);
  }

  function cancelForm() {
    setShowAddForm(false);
    setEditingItem(null);
    setFormData({ name: '', price: '', category_id: null, categorySearchTerm: '' });
    setMenuItemComponents([]);
    setFilteredIngredients([]);
    setActiveSearchComponentIndex(null);
    setActiveSearchIngredientIndex(null);
    setUnitSuggestions([]);
    setActiveUnitComponentIndex(null);
    setActiveUnitIngredientIndex(null);
    setHighlightedUnitIndex(-1);
    setFilteredCategories([]);
    setHighlightedCategoryIndex(-1);
  }

  async function handleSubmit() {
    try {
      setSaving(true);
      console.log(`\n🍽️ Saving menu item: ${formData.name}`);

      // Validate form
      if (!formData.name || !formData.price) {
        alert('Please fill in menu item name and price');
        return;
      }

      if (menuItemComponents.length === 0) {
        alert('Please add at least one component');
        return;
      }

      // Validate components and units
      for (let compIndex = 0; compIndex < menuItemComponents.length; compIndex++) {
        const component = menuItemComponents[compIndex];
        
        if (!component.name) {
          alert('Please name all components');
          return;
        }
        
        if (!component.ingredients || component.ingredients.length === 0) {
          alert(`Please add ingredients to the "${component.name}" component`);
          return;
        }

        console.log(`🧩 Validating component: ${component.name}`);

        // Validate ingredients and their units
        for (let ingIndex = 0; ingIndex < component.ingredients.length; ingIndex++) {
          const ingredient = component.ingredients[ingIndex];
          
          if (!ingredient.quantity) {
            alert(`Please enter quantity for all ingredients in "${component.name}"`);
            return;
          }

          if (!ingredient.unit) {
            alert(`Please enter unit for all ingredients in "${component.name}"`);
            return;
          }

          // Validate that the unit is supported
          const unitValidation = validateUnit(ingredient.unit);
          if (!unitValidation.valid) {
            alert(`Invalid unit "${ingredient.unit}" for ingredient in "${component.name}". ${unitValidation.message}\n\nSupported units include: oz, lbs, g, kg, fl oz, cups, tbsp, tsp, gallons, ml, l, each, etc.`);
            return;
          }

          console.log(`  ✅ ${ingredient.ingredient_search}: ${ingredient.quantity} ${ingredient.unit} (${unitValidation.category})`);

          // Handle ingredient creation/linking
          if (!ingredient.ingredient_id && ingredient.ingredient_search) {
            console.log(`🔍 Checking for existing ingredient: ${ingredient.ingredient_search}`);
            
            // First, check if this ingredient already exists for this restaurant
            const { data: existingIngredient, error: checkError } = await supabase
              .from('ingredients')
              .select('id, name, unit, last_price')
              .eq('restaurant_id', selectedRestaurant.id)
              .ilike('name', ingredient.ingredient_search.trim())
              .maybeSingle();

            if (checkError) {
              console.error('Error checking for existing ingredient:', checkError);
              alert('Error checking ingredients: ' + checkError.message);
              return;
            }

            if (existingIngredient) {
              // Ingredient already exists, use it
              console.log(`✅ Found existing ingredient: ${existingIngredient.name} (${existingIngredient.unit})`);
              ingredient.ingredient_id = existingIngredient.id;
              ingredient.ingredient_search = existingIngredient.name;
            } else {
              // Ingredient doesn't exist, create it with standardized unit
              console.log(`🆕 Creating new ingredient: ${ingredient.ingredient_search}`);

              // Determine what standard unit this ingredient should use based on the recipe unit
              const standardUnit = getStandardUnitForUnit(ingredient.unit);
              const category = getUnitCategory(ingredient.unit);

              console.log(`   Creating with standard unit: ${standardUnit} (category: ${category})`);

              const { data: newIngredient, error: createError } = await supabase
                .from('ingredients')
                .insert({
                  restaurant_id: selectedRestaurant.id,
                  name: ingredient.ingredient_search.trim(),
                  unit: standardUnit, // Store in standard unit
                  last_price: 0, // Will be updated when invoices are processed
                  last_ordered_at: null
                })
                .select()
                .single();

              if (createError) {
                console.error('Failed to create ingredient:', createError);
                alert(`Failed to create ingredient "${ingredient.ingredient_search}": ${createError.message}`);
                return;
              }

              console.log(`✅ Created ingredient: ${newIngredient.name} (ID: ${newIngredient.id})`);
              ingredient.ingredient_id = newIngredient.id;
              
              // Add to local ingredients array so it shows up in future searches
              setIngredients(prev => [...prev, newIngredient]);
            }
          }

          if (!ingredient.ingredient_id || !ingredient.quantity) {
            alert(`Please complete all ingredient fields in "${component.name}"`);
            return;
          }
        }
      }

      let menuItemId;

      if (editingItem) {
        // Update existing menu item
        console.log('📝 Updating existing menu item:', editingItem.id);
        
        const { error: updateError } = await supabase
          .from('menu_items')
          .update({
            name: formData.name,
            price: parseFloat(formData.price),
            category_id: formData.category_id || null
          })
          .eq('id', editingItem.id);

        if (updateError) throw updateError;
        menuItemId = editingItem.id;

        // Delete existing components and their ingredients (cascade will handle component_ingredients)
        console.log('🗑️ Deleting existing components for menu item:', menuItemId);
        const { error: deleteError } = await supabase
          .from('menu_item_components')
          .delete()
          .eq('menu_item_id', editingItem.id);

        if (deleteError) throw deleteError;
      } else {
        // Create new menu item
        console.log('🆕 Creating new menu item:', formData.name);
        
        const { data: newMenuItem, error: insertError } = await supabase
          .from('menu_items')
          .insert({
            restaurant_id: selectedRestaurant.id,
            name: formData.name,
            price: parseFloat(formData.price),
            category_id: formData.category_id || null,
            cost: 0 // Will be calculated
          })
          .select()
          .single();

        if (insertError) throw insertError;
        menuItemId = newMenuItem.id;
        console.log('✅ Created menu item with ID:', menuItemId);
      }

      // Insert components and their ingredients
      for (let componentIndex = 0; componentIndex < menuItemComponents.length; componentIndex++) {
        const component = menuItemComponents[componentIndex];
        
        console.log(`🧩 Creating component ${componentIndex + 1}: ${component.name}`);
        
        // Insert component
        const { data: newComponent, error: componentError } = await supabase
          .from('menu_item_components')
          .insert({
            menu_item_id: menuItemId,
            name: component.name,
            cost: 0 // Will be calculated
          })
          .select()
          .single();

        if (componentError) {
          console.error('Component creation error:', componentError);
          throw componentError;
        }

        console.log('✅ Created component with ID:', newComponent.id);

        // Insert ingredients for this component
        const ingredientsToInsert = component.ingredients.map(ing => ({
          component_id: newComponent.id,
          ingredient_id: ing.ingredient_id,
          quantity: parseFloat(ing.quantity),
          unit: ing.unit || 'each' // Keep the recipe unit as entered
        }));

        console.log(`📦 Inserting ${ingredientsToInsert.length} component ingredients:`, ingredientsToInsert);

        const { error: ingredientsError } = await supabase
          .from('component_ingredients')
          .insert(ingredientsToInsert);

        if (ingredientsError) {
          console.error('Component ingredients creation error:', ingredientsError);
          throw ingredientsError;
        }

        // Calculate and update component cost
        await calculateComponentCost(newComponent.id);
      }

      // Calculate and update menu item cost
      await calculateMenuItemCost(menuItemId);

      console.log('🎉 Menu item saved successfully');
      alert(editingItem ? 'Menu item updated successfully!' : 'Menu item added successfully!');
      cancelForm();
      fetchMenuItems();

    } catch (error) {
      console.error('❌ Error saving menu item:', error);
      alert('Failed to save menu item: ' + error.message);
    } finally {
      setSaving(false);
    }
  }

  async function calculateComponentCost(componentId) {
    try {
      console.log(`\n💰 Calculating cost for component: ${componentId}`);
      
      const { data: componentIngredients, error } = await supabase
        .from('component_ingredients')
        .select(`
          quantity,
          unit,
          ingredients:ingredient_id (
            id,
            name,
            last_price,
            unit
          )
        `)
        .eq('component_id', componentId);

      if (error) throw error;

      let totalCost = 0;
      console.log(`🧮 Processing ${componentIngredients.length} ingredients:`);

      componentIngredients.forEach(ing => {
        const recipeQuantity = ing.quantity;
        const recipeUnit = ing.unit;
        const ingredient = ing.ingredients;
        const ingredientCost = ingredient?.last_price || 0;
        const ingredientName = ingredient?.name || 'Unknown';
        const ingredientStandardUnit = ingredient?.unit || 'unknown';

        console.log(`  🥬 ${ingredientName}:`);
        console.log(`     Recipe needs: ${recipeQuantity} ${recipeUnit}`);
        console.log(`     Ingredient cost: ${ingredientCost.toFixed(4)}/${ingredientStandardUnit}`);

        if (ingredientCost > 0) {
          try {
            // Use the standardized cost calculation
            const cost = calculateStandardizedCost(
              recipeQuantity,
              recipeUnit,
              ingredientCost,
              ingredientName
            );
            totalCost += cost;
            
            console.log(`     Calculated cost: ${cost.toFixed(4)}`);
          } catch (error) {
            console.warn(`     ⚠️ Cost calculation failed: ${error.message}`);
            // Fallback to simple multiplication
            const fallbackCost = recipeQuantity * ingredientCost;
            totalCost += fallbackCost;
            console.log(`     Fallback cost: ${fallbackCost.toFixed(4)}`);
          }
        } else {
          console.log(`     ⚠️ No cost data available`);
        }
      });

      console.log(`📊 Component total cost: ${totalCost.toFixed(4)}`);

      const { error: updateError } = await supabase
        .from('menu_item_components')
        .update({ cost: totalCost })
        .eq('id', componentId);

      if (updateError) {
        console.error('Failed to update component cost:', updateError);
      }

      return totalCost;

    } catch (error) {
      console.error('Error calculating component cost:', error);
      return 0;
    }
  }

  async function calculateMenuItemCost(menuItemId) {
    try {
      console.log(`\n📊 Calculating total cost for menu item: ${menuItemId}`);
      
      const { data: components, error } = await supabase
        .from('menu_item_components')
        .select('id, name, cost')
        .eq('menu_item_id', menuItemId);

      if (error) throw error;

      let totalCost = 0;
      console.log(`🧩 Processing ${components.length} components:`);

      components.forEach(comp => {
        const componentCost = comp.cost || 0;
        totalCost += componentCost;
        console.log(`  ${comp.name}: ${componentCost.toFixed(4)}`);
      });
      
      console.log(`🍽️ Menu item total cost: ${totalCost.toFixed(4)}`);

      const { error: updateError } = await supabase
        .from('menu_items')
        .update({ cost: totalCost })
        .eq('id', menuItemId);

      if (updateError) {
        console.error('Failed to update menu item cost:', updateError);
      }

      return totalCost;

    } catch (error) {
      console.error('Error calculating menu item cost:', error);
      return 0;
    }
  }

  async function deleteMenuItem(item) {
    if (!window.confirm(`Are you sure you want to delete "${item.name}"?`)) return;

    try {
      console.log('🗑️ Deleting menu item:', item.id);
      
      // Components and their ingredients will be deleted by cascade
      const { error } = await supabase
        .from('menu_items')
        .delete()
        .eq('id', item.id);

      if (error) throw error;

      console.log('✅ Menu item deleted successfully');
      alert('Menu item deleted successfully!');
      fetchMenuItems();
    } catch (error) {
      console.error('❌ Error deleting menu item:', error);
      alert('Failed to delete menu item');
    }
  }

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
          <div className="max-w-2xl mx-auto">
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
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
                <div className="space-y-4">
                  {/* Restaurant Search */}
                  <div>
                    <label htmlFor="restaurant_search" className="block text-sm font-medium text-gray-700 mb-2">
                      Search Restaurant
                    </label>
                    <div className="relative">
                      <input
                        id="restaurant_search"
                        type="text"
                        value={restaurantSearchTerm}
                        onChange={(e) => handleRestaurantSearch(e.target.value)}
                        onKeyDown={handleRestaurantKeyDown}
                        placeholder="Type to search restaurants..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                      {filteredRestaurants.length > 0 && (
                        <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-48 overflow-y-auto">
                          {filteredRestaurants.map((restaurant, index) => (
                            <div
                              key={restaurant.id}
                              className={`px-3 py-3 cursor-pointer text-sm border-b border-gray-100 last:border-b-0 ${
                                index === highlightedRestaurantIndex ? 'bg-blue-500 text-white' : 'hover:bg-gray-100'
                              }`}
                              onClick={() => selectRestaurantForConfirm(restaurant)}
                              onMouseEnter={() => setHighlightedRestaurantIndex(index)}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${
                                  index === highlightedRestaurantIndex ? 'bg-blue-600' : 'bg-[#ADD8E6]'
                                }`}>
                                  <IconBuilding size={16} className={index === highlightedRestaurantIndex ? 'text-white' : 'text-gray-900'} />
                                </div>
                                <div>
                                  <div className="font-medium">{restaurant.name}</div>
                                  <div className={`text-xs ${index === highlightedRestaurantIndex ? 'text-blue-100' : 'text-gray-500'}`}>
                                    Click to select
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Selected Restaurant Display */}
                  {selectedRestaurantForConfirm && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-lg">
                          <IconBuilding size={20} className="text-blue-700" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900">{selectedRestaurantForConfirm.name}</h4>
                          <p className="text-sm text-gray-600">Selected restaurant</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Confirmation Input */}
                  {selectedRestaurantForConfirm && (
                    <div>
                      <label htmlFor="confirmation" className="block text-sm font-medium text-gray-700 mb-2">
                        Type the restaurant name to confirm
                      </label>
                      <div className="space-y-3">
                        <input
                          id="confirmation"
                          type="text"
                          value={confirmationText}
                          onChange={(e) => setConfirmationText(e.target.value)}
                          placeholder={`Type "${selectedRestaurantForConfirm.name}" to confirm`}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                        <button
                          onClick={handleConfirmRestaurant}
                          disabled={confirmationText.trim() !== selectedRestaurantForConfirm.name}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
                        >
                          <IconCheck size={16} />
                          Confirm & Manage Menu Items
                        </button>
                      </div>
                    </div>
                  )}

                  {!selectedRestaurantForConfirm && restaurantSearchTerm && filteredRestaurants.length === 0 && (
                    <div className="text-center py-4 text-gray-500 text-sm">
                      No restaurants found matching "{restaurantSearchTerm}"
                    </div>
                  )}
                </div>
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
                    onClick={startAddItem}
                  >
                    <IconPlus size={18} />
                    Add Menu Item
                  </button>
                </div>
              </div>
            </div>

            {/* Add/Edit Form */}
            {showAddForm && (
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="border-b border-gray-200 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {editingItem ? 'Edit Menu Item' : 'Add New Menu Item'}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {editingItem ? 'Update the details and components' : 'Create a new menu item with its components'}
                      </p>
                    </div>
                    <button 
                      className="flex items-center gap-2 px-3 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors" 
                      onClick={cancelForm}
                    >
                      <IconX size={18} />
                      Cancel
                    </button>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  {/* Basic Info Section */}
                  <div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">Menu Item Name</label>
                        <input
                          id="name"
                          name="name"
                          type="text"
                          value={formData.name}
                          onChange={handleFormChange}
                          placeholder="e.g., Caesar Salad"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                      </div>
                      <div>
                        <label htmlFor="price" className="block text-sm font-medium text-gray-700 mb-2">Price ($)</label>
                        <input
                          id="price"
                          name="price"
                          type="number"
                          step="0.01"
                          value={formData.price}
                          onChange={handleFormChange}
                          placeholder="0.00"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                      </div>
                      <div>
                        <label htmlFor="category_search" className="block text-sm font-medium text-gray-700 mb-2">
                          Category
                        </label>
                        <div className="relative">
                          <input
                            id="category_search"
                            type="text"
                            value={formData.categorySearchTerm || ''}
                            onChange={(e) => handleCategorySearch(e.target.value)}
                            onKeyDown={handleCategoryKeyDown}
                            placeholder="Type to search or create category..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                          />
                          {filteredCategories.length > 0 && (
                            <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-32 overflow-y-auto">
                              {filteredCategories.map((category, index) => (
                                <div
                                  key={category.id}
                                  className={`px-3 py-2 cursor-pointer text-sm ${
                                    index === highlightedCategoryIndex ? 'bg-blue-500 text-white' : 'hover:bg-gray-100'
                                  }`}
                                  onClick={() => selectCategory(category)}
                                  onMouseEnter={() => setHighlightedCategoryIndex(index)}
                                >
                                  {category.name}
                                </div>
                              ))}
                            </div>
                          )}
                          {formData.categorySearchTerm && 
                           formData.categorySearchTerm.trim() && 
                           !categories.find(cat => cat.name.toLowerCase() === formData.categorySearchTerm.toLowerCase().trim()) && (
                            <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg">
                              <div className="px-3 py-2 text-sm text-gray-600 border-b">
                                <div className="flex items-center gap-2">
                                  <IconPlus size={14} />
                                  Press Enter to create "{formData.categorySearchTerm.trim()}"
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Components Section */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-base font-medium text-gray-900">Menu Item Components</h4>
                      <button 
                        className="flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors text-sm font-medium"
                        onClick={addComponentRow}
                      >
                        <IconPlus size={16} />
                        Add Component
                      </button>
                    </div>

                    {menuItemComponents.length === 0 ? (
                      <div className="text-center py-8 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg">
                        <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-full mx-auto mb-3">
                          <IconSearch size={24} className="text-gray-400" />
                        </div>
                        <h5 className="text-sm font-medium text-gray-900 mb-1">No components added yet</h5>
                        <p className="text-xs text-gray-500">Click "Add Component" to start building your menu item</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                        {menuItemComponents.map((component, componentIndex) => (
                          <div key={component.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                            {/* Component Header */}
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-xs font-medium text-gray-600 bg-white px-2 py-1 rounded">
                                Component #{componentIndex + 1}
                              </span>
                              <button
                                className="flex items-center justify-center w-6 h-6 text-gray-400 hover:text-red-600 hover:bg-white rounded transition-colors"
                                onClick={() => removeComponentRow(componentIndex)}
                                title="Remove component"
                              >
                                <IconTrash size={14} />
                              </button>
                            </div>

                            {/* Component Name */}
                            <div className="mb-3">
                              <input
                                type="text"
                                value={component.name}
                                onChange={(e) => handleComponentChange(componentIndex, 'name', e.target.value)}
                                placeholder="Component Name"
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent bg-white"
                              />
                            </div>

                            {/* Ingredients Header */}
                            <div className="flex items-center justify-between mb-3">
                              <h5 className="text-xs font-medium text-gray-700">Ingredients</h5>
                              <button 
                                className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded text-xs font-medium hover:bg-blue-100 transition-colors"
                                onClick={() => addIngredientToComponent(componentIndex)}
                              >
                                <IconPlus size={12} />
                                Add
                              </button>
                            </div>

                            {/* Ingredients List */}
                            <div className="space-y-2 min-h-[80px]">
                              {(!component.ingredients || component.ingredients.length === 0) ? (
                                <div className="text-center py-4 text-gray-500 text-xs bg-white border border-gray-200 rounded">
                                  No ingredients added
                                </div>
                              ) : (
                                <>
                                  {/* Header Row */}
                                  <div className="grid grid-cols-6 gap-1 text-xs font-medium text-gray-600 pb-1">
                                    <div className="col-span-2">Ingredient</div>
                                    <div>Qty</div>
                                    <div>Unit</div>
                                    <div></div>
                                  </div>
                                  
                                  {/* Ingredient Rows */}
                                  {component.ingredients.map((ingredient, ingredientIndex) => (
                                    <div key={ingredient.id} className="grid grid-cols-6 gap-1 items-center bg-white border border-gray-200 rounded p-2">
                                      {/* Ingredient Name */}
                                      <div className="col-span-2 relative">
                                        <input
                                          type="text"
                                          value={ingredient.ingredient_search}
                                          onChange={(e) => handleIngredientSearch(componentIndex, ingredientIndex, e.target.value)}
                                          placeholder="Ingredient name..."
                                          className="w-full px-2 py-1 text-xs border-0 focus:ring-1 focus:ring-blue-500 rounded"
                                        />
                                        {filteredIngredients.length > 0 && 
                                         activeSearchComponentIndex === componentIndex && 
                                         activeSearchIngredientIndex === ingredientIndex && (
                                          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-32 overflow-y-auto">
                                            {filteredIngredients.map(ing => (
                                              <div
                                                key={ing.id}
                                                className="px-2 py-1.5 hover:bg-gray-100 cursor-pointer text-xs"
                                                onClick={() => selectIngredient(componentIndex, ingredientIndex, ing)}
                                              >
                                                <div className="font-medium text-gray-900">{ing.name}</div>
                                                <div className="text-xs text-gray-500">
                                                  {ing.unit} • ${ing.last_price?.toFixed(2) || '0.00'}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      
                                      {/* Quantity */}
                                      <div>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={ingredient.quantity}
                                          onChange={(e) => handleIngredientChange(componentIndex, ingredientIndex, 'quantity', e.target.value)}
                                          placeholder="0"
                                          className="w-full px-2 py-1 text-xs border-0 focus:ring-1 focus:ring-blue-500 rounded"
                                        />
                                      </div>

                                      {/* Unit */}
                                      <div className="relative">
                                        <input
                                          type="text"
                                          value={ingredient.unit || ''}
                                          onChange={(e) => handleUnitSearch(componentIndex, ingredientIndex, e.target.value)}
                                          onKeyDown={(e) => handleUnitKeyDown(e, componentIndex, ingredientIndex)}
                                          placeholder="Unit"
                                          className="w-full px-2 py-1 text-xs border-0 focus:ring-1 focus:ring-blue-500 rounded"
                                        />
                                        {unitSuggestions.length > 0 && 
                                         activeUnitComponentIndex === componentIndex && 
                                         activeUnitIngredientIndex === ingredientIndex && (
                                          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-32 overflow-y-auto">
                                            {unitSuggestions.map((suggestion, unitIndex) => (
                                              <div
                                                key={suggestion.unit}
                                                className={`px-2 py-1.5 cursor-pointer text-xs ${
                                                  unitIndex === highlightedUnitIndex ? 'bg-blue-500 text-white' : 'hover:bg-gray-100'
                                                }`}
                                                onClick={() => selectUnit(componentIndex, ingredientIndex, suggestion)}
                                                onMouseEnter={() => setHighlightedUnitIndex(unitIndex)}
                                              >
                                                <div className="font-medium">{suggestion.unit}</div>
                                                <div className={`text-xs ${unitIndex === highlightedUnitIndex ? 'text-blue-100' : 'text-gray-500'}`}>
                                                  {suggestion.description}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>

                                      {/* Delete Button */}
                                      <div className="flex justify-center">
                                        <button
                                          className="flex items-center justify-center w-5 h-5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                          onClick={() => removeIngredientFromComponent(componentIndex, ingredientIndex)}
                                          title="Remove ingredient"
                                        >
                                          <IconX size={12} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex justify-end pt-4 border-t border-gray-200">
                      <button 
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        onClick={handleSubmit}
                        disabled={saving}
                      >
                        {saving ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Saving...
                          </>
                        ) : (
                          <>
                            <IconCheck size={16} />
                            {editingItem ? 'Update Menu Item' : 'Save Menu Item'}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Menu Items Table */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Current Menu Items</h3>
                    <p className="text-gray-600">{menuItems.length} items</p>
                  </div>
                  <button 
                    className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    onClick={fetchMenuItems}
                  >
                    <IconRefresh size={18} />
                    Refresh
                  </button>
                </div>
              </div>
              
              {menuItems.length === 0 ? (
                <div className="text-center py-12">
                  <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6">
                    <IconSearch size={32} className="text-gray-400" />
                  </div>
                  <h4 className="text-xl font-semibold text-gray-900 mb-4">No menu items yet</h4>
                  <p className="text-gray-600 mb-6">Start building your menu by adding your first item!</p>
                  <button 
                    className="inline-flex items-center gap-2 px-6 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
                    onClick={startAddItem}
                  >
                    <IconPlus size={18} />
                    Add Your First Menu Item
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  {/* Desktop Table */}
                  <div className="hidden lg:block">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Name</th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Category</th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Components</th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Price</th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Cost</th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Margin</th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {menuItems.map(item => {
                          const margin = item.price > 0 ? ((item.price - item.cost) / item.price * 100) : 0;
                          const componentCount = item.menu_item_components?.length || 0;
                          
                          return (
                            <tr key={item.id} className="hover:bg-gray-50">
                              <td className="py-4 px-6">
                                <div 
                                  className="cursor-pointer hover:text-[#ADD8E6] transition-colors"
                                  onClick={() => router.push(`/admin/menu-item-cost-breakdown/${item.id}`)}
                                  title="Click to view detailed cost breakdown"
                                >
                                  <div className="font-medium text-gray-900">{item.name}</div>
                                  <div className="text-sm text-gray-500">Click for cost breakdown →</div>
                                </div>
                              </td>
                              <td className="py-4 px-6">
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                  {item.menu_categories?.name || 'Uncategorized'}
                                </span>
                              </td>
                              <td className="py-4 px-6">
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                    {componentCount} {componentCount === 1 ? 'component' : 'components'}
                                  </span>
                                </div>
                              </td>
                              <td className="py-4 px-6">
                                <div className="flex items-center gap-1">
                                  <IconCurrencyDollar size={16} className="text-gray-400" />
                                  <span className="font-medium text-gray-900">${item.price.toFixed(2)}</span>
                                </div>
                              </td>
                              <td className="py-4 px-6">
                                <div className="flex items-center gap-1">
                                  <IconCurrencyDollar size={16} className="text-gray-400" />
                                  <span className="text-gray-900">${item.cost.toFixed(2)}</span>
                                </div>
                              </td>
                              <td className="py-4 px-6">
                                <div className="flex items-center gap-1">
                                  <IconPercentage size={16} className="text-gray-400" />
                                  <span className={`font-medium ${
                                    margin > 30 ? 'text-green-600' : 
                                    margin > 15 ? 'text-yellow-600' : 'text-red-600'
                                  }`}>
                                    {margin.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                              <td className="py-4 px-6">
                                <div className="flex items-center gap-2">
                                  <button 
                                    className="flex items-center gap-1 px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors text-sm"
                                    onClick={() => router.push(`/admin/menu-item-cost-breakdown/${item.id}`)}
                                    title="View cost breakdown"
                                  >
                                    <IconEye size={16} />
                                    View
                                  </button>
                                  <button 
                                    className="flex items-center gap-1 px-3 py-1.5 text-[#ADD8E6] hover:text-[#9CC5D4] hover:bg-blue-50 rounded-md transition-colors text-sm"
                                    onClick={() => startEditItem(item)}
                                    title="Edit menu item"
                                  >
                                    <IconPencil size={16} />
                                    Edit
                                  </button>
                                  <button 
                                    className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors text-sm"
                                    onClick={() => deleteMenuItem(item)}
                                    title="Delete menu item"
                                  >
                                    <IconTrash size={16} />
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="lg:hidden">
                    {menuItems.map(item => {
                      const margin = item.price > 0 ? ((item.price - item.cost) / item.price * 100) : 0;
                      const componentCount = item.menu_item_components?.length || 0;
                      
                      return (
                        <div key={item.id} className="p-6 border-b border-gray-200 last:border-b-0">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                              <h3 
                                className="font-semibold text-gray-900 mb-2 cursor-pointer hover:text-[#ADD8E6] transition-colors"
                                onClick={() => router.push(`/admin/menu-item-cost-breakdown/${item.id}`)}
                              >
                                {item.name}
                              </h3>
                              <div className="text-sm text-gray-500 mb-3">
                                Click for cost breakdown →
                              </div>
                            </div>
                            
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                              margin > 30 ? 'bg-green-100 text-green-800' : 
                              margin > 15 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {margin.toFixed(1)}% margin
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                              <div className="text-sm text-gray-500 mb-1">Category</div>
                              <div className="text-sm font-medium text-gray-900">
                                {item.menu_categories?.name || 'Uncategorized'}
                              </div>
                            </div>
                            <div>
                              <div className="text-sm text-gray-500 mb-1">Components</div>
                              <div className="text-sm font-medium text-gray-900">
                                {componentCount} {componentCount === 1 ? 'component' : 'components'}
                              </div>
                            </div>
                            <div>
                              <div className="text-sm text-gray-500 mb-1">Price / Cost</div>
                              <div className="text-sm font-medium text-gray-900">
                                ${item.price.toFixed(2)} / ${item.cost.toFixed(2)}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex gap-2">
                            <button 
                              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors text-sm"
                              onClick={() => router.push(`/admin/menu-item-cost-breakdown/${item.id}`)}
                            >
                              <IconEye size={16} />
                              View
                            </button>
                            <button 
                              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-[#ADD8E6] hover:text-[#9CC5D4] hover:bg-blue-50 rounded-lg transition-colors text-sm"
                              onClick={() => startEditItem(item)}
                            >
                              <IconPencil size={16} />
                              Edit
                            </button>
                            <button 
                              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors text-sm"
                              onClick={() => deleteMenuItem(item)}
                            >
                              <IconTrash size={16} />
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}