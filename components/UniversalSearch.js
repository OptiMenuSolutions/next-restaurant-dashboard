// components/UniversalSearch.js
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import supabase from '../lib/supabaseClient';
import {
  IconSearch,
  IconX,
  IconFileText,
  IconChefHat,
  IconPackage,
  IconCurrencyDollar,
  IconCalendar,
  IconBuilding,
  IconLoader,
} from '@tabler/icons-react';

export default function UniversalSearch({ restaurantId, placeholder = "Search invoices, ingredients, menu items..." }) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);

  // Debounce search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchTerm.trim() && restaurantId) {
        performSearch(searchTerm.trim());
      } else {
        setSearchResults([]);
        setShowDropdown(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, restaurantId]);

  // Handle clicks outside dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        searchRef.current && 
        !searchRef.current.contains(event.target) &&
        dropdownRef.current && 
        !dropdownRef.current.contains(event.target)
      ) {
        setShowDropdown(false);
        setSelectedIndex(-1);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function performSearch(query) {
    if (!restaurantId) return;
    
    setIsSearching(true);
    const results = [];

    try {
      // Search invoices
      const { data: invoices, error: invoicesError } = await supabase
        .from('invoices')
        .select('id, number, supplier, amount, date, created_at')
        .eq('restaurant_id', restaurantId)
        .or(`number.ilike.%${query}%,supplier.ilike.%${query}%`)
        .limit(5);

      if (!invoicesError && invoices) {
        invoices.forEach(invoice => {
          results.push({
            id: invoice.id,
            type: 'invoice',
            title: invoice.number || 'Unnamed Invoice',
            subtitle: invoice.supplier || 'Unknown Supplier',
            detail: invoice.amount ? formatCurrency(invoice.amount) : 'No amount',
            date: invoice.date || invoice.created_at,
            data: invoice
          });
        });
      }

      // Search ingredients
      const { data: ingredients, error: ingredientsError } = await supabase
        .from('ingredients')
        .select('id, name, unit, last_price, last_ordered_at')
        .eq('restaurant_id', restaurantId)
        .ilike('name', `%${query}%`)
        .limit(5);

      if (!ingredientsError && ingredients) {
        ingredients.forEach(ingredient => {
          results.push({
            id: ingredient.id,
            type: 'ingredient',
            title: ingredient.name || 'Unnamed Ingredient',
            subtitle: ingredient.unit || 'No unit',
            detail: ingredient.last_price ? formatCurrency(ingredient.last_price) : 'No price',
            date: ingredient.last_ordered_at,
            data: ingredient
          });
        });
      }

      // Search menu items
      const { data: menuItems, error: menuItemsError } = await supabase
        .from('menu_items')
        .select('id, name, price, cost')
        .eq('restaurant_id', restaurantId)
        .ilike('name', `%${query}%`)
        .limit(5);

      if (!menuItemsError && menuItems) {
        menuItems.forEach(menuItem => {
          const margin = calculateMargin(menuItem.price, menuItem.cost);
          results.push({
            id: menuItem.id,
            type: 'menu_item',
            title: menuItem.name || 'Unnamed Menu Item',
            subtitle: menuItem.price ? formatCurrency(menuItem.price) : 'No price',
            detail: margin !== '--' ? `${margin} margin` : 'No margin data',
            date: null,
            data: menuItem
          });
        });
      }

      // Sort results by relevance (exact matches first, then partial matches)
      results.sort((a, b) => {
        const aExact = a.title.toLowerCase().includes(query.toLowerCase());
        const bExact = b.title.toLowerCase().includes(query.toLowerCase());
        
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        
        // Then by type priority: menu_item, ingredient, invoice
        const typePriority = { menu_item: 0, ingredient: 1, invoice: 2 };
        return typePriority[a.type] - typePriority[b.type];
      });

      setSearchResults(results);
      setShowDropdown(results.length > 0);
      setSelectedIndex(-1);

    } catch (error) {
      console.error('Search error:', error);
      setSearchResults([]);
      setShowDropdown(false);
    } finally {
      setIsSearching(false);
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
      minimumFractionDigits: 0,
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

  function formatDate(dateString) {
    if (!dateString) return "";
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return "";
    }
  }

  function getTypeIcon(type) {
    switch (type) {
      case 'invoice':
        return <IconFileText size={16} className="text-blue-600" />;
      case 'ingredient':
        return <IconPackage size={16} className="text-green-600" />;
      case 'menu_item':
        return <IconChefHat size={16} className="text-purple-600" />;
      default:
        return <IconSearch size={16} className="text-gray-600" />;
    }
  }

  function getTypeLabel(type) {
    switch (type) {
      case 'invoice':
        return 'Invoice';
      case 'ingredient':
        return 'Ingredient';
      case 'menu_item':
        return 'Menu Item';
      default:
        return 'Item';
    }
  }

  function handleResultClick(result) {
    setSearchTerm('');
    setShowDropdown(false);
    setSelectedIndex(-1);

    // Navigate to appropriate page with query parameters to open the specific item
    switch (result.type) {
      case 'invoice':
        router.push(`/client/invoices?selected=${result.id}`);
        break;
      case 'ingredient':
        router.push(`/client/ingredients?selected=${result.id}`);
        break;
      case 'menu_item':
        router.push(`/client/menu-items?selected=${result.id}`);
        break;
    }
  }

  function handleKeyDown(e) {
    if (!showDropdown || searchResults.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < searchResults.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : searchResults.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
          handleResultClick(searchResults[selectedIndex]);
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        setSelectedIndex(-1);
        searchRef.current?.blur();
        break;
    }
  }

  function clearSearch() {
    setSearchTerm('');
    setSearchResults([]);
    setShowDropdown(false);
    setSelectedIndex(-1);
  }

  return (
    <div className="relative w-full" style={{ height: '100%' }}>
      <div className="relative" ref={searchRef} style={{ height: '100%' }}>
        <input
          type="text"
          placeholder={placeholder}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={e => {
            e.target.style.borderColor = '#02a4ba';
            if (searchResults.length > 0) setShowDropdown(true);
          }}
          onBlur={e => { e.target.style.borderColor = '#2a2620'; }}
          style={{
            width: '100%',
            height: '100%',
            paddingLeft: '2rem',
            paddingRight: '2rem',
            paddingTop: '0.375rem',
            paddingBottom: '0.375rem',
            background: '#1a1915',
            border: '1px solid #2a2620',
            borderRadius: '0.375rem',
            color: '#e8e2d8',
            fontSize: '0.8125rem',
            fontFamily: "'Inter', sans-serif",
            outline: 'none',
          }}
        />
        
        {/* Search Icon */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '0.75rem',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
        }}>
          {isSearching ? (
            <IconLoader size={16} style={{ color: '#4a453e' }} className="animate-spin" />
          ) : (
            <IconSearch size={16} style={{ color: '#4a453e' }} />
          )}
        </div>

        {/* Clear Button */}
        {searchTerm && (
          <button 
            onClick={clearSearch} 
            className="absolute right-3 top-1/2 transform -translate-y-1/2 transition-colors"
            style={{ color: '#4a453e' }}
            onMouseEnter={e => e.currentTarget.style.color = '#9a9086'}
            onMouseLeave={e => e.currentTarget.style.color = '#4a453e'}
          >
            <IconX size={16} />
          </button>
        )}
      </div>

      {/* Dropdown Results */}
      {showDropdown && searchResults.length > 0 && (
        <div 
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto"
          style={{ background: '#13120f', border: '1px solid #2a2620' }}
        >
          <div className="py-2">
            {searchResults.map((result, index) => (
              <div
                key={`${result.type}-${result.id}`}
                onClick={() => handleResultClick(result)}
                className={`px-4 py-3 cursor-pointer transition-colors ${
                  index === selectedIndex 
                    ? 'border-l-4' 
                    : ''
                }`}
                style={{
                  borderLeftColor: index === selectedIndex ? '#02a4ba' : undefined,
                  background: index === selectedIndex ? 'rgba(2,164,186,0.08)' : undefined,
                }}
                onMouseEnter={e => { if (index !== selectedIndex) e.currentTarget.style.background = '#1a1915'; }}
                onMouseLeave={e => { if (index !== selectedIndex) e.currentTarget.style.background = ''; }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    {getTypeIcon(result.type)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium truncate" style={{ color: '#e8e2d8' }}>
                          {result.title}
                        </h4>
                        <p className="text-xs truncate" style={{ color: '#6b6358' }}>
                          {result.subtitle}
                        </p>
                      </div>
                      
                      <div className="flex-shrink-0 text-right ml-4">
                        <div className="text-sm font-medium" style={{ color: '#e8e2d8' }}>
                          {result.detail}
                        </div>
                        {result.date && (
                          <div className="text-xs" style={{ color: '#6b6358' }}>
                            {formatDate(result.date)}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="mt-1">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          background: result.type === 'invoice'    ? 'rgba(2,164,186,0.12)'  :
                                      result.type === 'ingredient' ? 'rgba(42,138,90,0.12)'  :
                                      'rgba(120,80,160,0.12)',
                          color:      result.type === 'invoice'    ? '#02a4ba'  :
                                      result.type === 'ingredient' ? '#2a8a5a'  :
                                      '#9060c0',
                        }}
                      >
                        {getTypeLabel(result.type)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Results */}
      {showDropdown && searchResults.length === 0 && !isSearching && searchTerm.trim() && (
        <div 
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 rounded-lg shadow-lg z-50"
          style={{ background: '#13120f', border: '1px solid #2a2620' }}
        >
          <div className="px-4 py-6 text-center">
            <IconSearch size={24} className="mx-auto mb-2" style={{ color: '#3a3630' }} />
            <p className="text-sm" style={{ color: '#6b6358' }}>No results found for "{searchTerm}"</p>
            <p className="text-xs mt-1" style={{ color: '#4a453e' }}>Try searching for invoices, ingredients, or menu items</p>
          </div>
        </div>
      )}
    </div>
  );
}