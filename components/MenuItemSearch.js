// components/MenuItemSearch.js
import React, { useState, useEffect, useRef } from 'react';
import supabase from '../lib/supabaseClient';
import {
  IconSearch,
  IconX,
  IconChefHat,
  IconLoader,
  IconCurrencyDollar,
  IconTrendingUp,
  IconTrendingDown,
  IconMinus,
} from '@tabler/icons-react';

export default function MenuItemSearch({ 
  restaurantId, 
  onMenuItemSelect, 
  placeholder = "Search menu items by name...",
  className = "w-full"
}) {
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

    try {
      // Search menu items by name
      const { data: menuItems, error } = await supabase
        .from('menu_items')
        .select('id, name, price, cost')
        .eq('restaurant_id', restaurantId)
        .ilike('name', `%${query}%`)
        .order('name')
        .limit(10);

      if (error) {
        console.error('Search error:', error);
        setSearchResults([]);
        setShowDropdown(false);
        return;
      }

      const results = (menuItems || []).map(menuItem => {
        const price = parseFloat(menuItem.price || 0);
        const cost = parseFloat(menuItem.cost || 0);
        const margin = calculateMargin(price, cost);
        const profitability = getProfitabilityStatus(margin);
        
        return {
          id: menuItem.id,
          name: menuItem.name || 'Unnamed Menu Item',
          price: price,
          cost: cost,
          margin: margin,
          profitability: profitability,
          hasCompleteData: price > 0 && cost > 0,
          data: menuItem
        };
      });

      // Sort results by relevance (exact matches first, then by name)
      results.sort((a, b) => {
        const aNameMatch = a.name.toLowerCase().includes(query.toLowerCase());
        const bNameMatch = b.name.toLowerCase().includes(query.toLowerCase());
        
        // Prioritize exact matches
        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        
        // Then alphabetically by name
        return a.name.localeCompare(b.name);
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

  function calculateMargin(price, cost) {
    if (price === 0 || cost === 0) return null;
    return ((price - cost) / price) * 100;
  }

  function getProfitabilityStatus(margin) {
    if (margin === null) return { status: 'unknown', label: 'Unknown', color: 'text-gray-500', icon: IconMinus };
    if (margin >= 70) return { status: 'excellent', label: 'Excellent', color: 'text-green-600', icon: IconTrendingUp };
    if (margin >= 50) return { status: 'good', label: 'Good', color: 'text-green-500', icon: IconTrendingUp };
    if (margin >= 30) return { status: 'fair', label: 'Fair', color: 'text-yellow-600', icon: IconMinus };
    return { status: 'poor', label: 'Poor', color: 'text-red-500', icon: IconTrendingDown };
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

  function handleResultClick(result) {
    setSearchTerm('');
    setShowDropdown(false);
    setSelectedIndex(-1);
    
    // Call the onMenuItemSelect callback with the selected menu item
    if (onMenuItemSelect) {
      onMenuItemSelect(result.data);
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
    <div className={`relative ${className}`}>
      <div className="relative" ref={searchRef}>
        <input
          type="text"
          placeholder={placeholder}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (searchResults.length > 0) {
              setShowDropdown(true);
            }
          }}
          className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
        />
        
        {/* Search Icon */}
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          {isSearching ? (
            <IconLoader size={16} className="text-gray-400 animate-spin" />
          ) : (
            <IconSearch size={16} className="text-gray-400" />
          )}
        </div>

        {/* Clear Button */}
        {searchTerm && (
          <button 
            onClick={clearSearch} 
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <IconX size={16} />
          </button>
        )}
      </div>

      {/* Dropdown Results */}
      {showDropdown && searchResults.length > 0 && (
        <div 
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto"
        >
          <div className="py-2">
            {searchResults.map((result, index) => {
              const ProfitIcon = result.profitability.icon;
              
              return (
                <div
                  key={result.id}
                  onClick={() => handleResultClick(result)}
                  className={`px-4 py-3 cursor-pointer transition-colors ${
                    index === selectedIndex 
                      ? 'bg-blue-50 border-l-4 border-blue-500' 
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      <IconChefHat size={16} className="text-purple-600" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-gray-900 truncate">
                            {result.name}
                          </h4>
                          <p className="text-xs text-gray-500 truncate flex items-center gap-1">
                            <IconCurrencyDollar size={12} />
                            Price: {result.price > 0 ? formatCurrency(result.price) : 'Not set'}
                          </p>
                        </div>
                        
                        <div className="flex-shrink-0 text-right ml-4">
                          {result.margin !== null ? (
                            <div className={`text-sm font-medium flex items-center gap-1 ${result.profitability.color}`}>
                              <ProfitIcon size={12} />
                              {result.margin.toFixed(1)}%
                            </div>
                          ) : (
                            <div className="text-sm text-gray-400 flex items-center gap-1">
                              <IconMinus size={12} />
                              No margin data
                            </div>
                          )}
                          <div className="text-xs text-gray-500">
                            Cost: {result.cost > 0 ? formatCurrency(result.cost) : 'Unknown'}
                          </div>
                        </div>
                      </div>
                      
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            result.hasCompleteData ? 'bg-green-500' : 'bg-yellow-500'
                          }`}></div>
                          <span className={`text-xs font-medium ${
                            result.hasCompleteData ? 'text-green-700' : 'text-yellow-600'
                          }`}>
                            {result.hasCompleteData ? 'Complete data' : 'Incomplete data'}
                          </span>
                          {result.margin !== null && (
                            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                              result.profitability.status === 'excellent' ? 'bg-green-100 text-green-800' :
                              result.profitability.status === 'good' ? 'bg-green-100 text-green-700' :
                              result.profitability.status === 'fair' ? 'bg-yellow-100 text-yellow-700' :
                              result.profitability.status === 'poor' ? 'bg-red-100 text-red-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {result.profitability.label}
                            </span>
                          )}
                        </div>
                        
                        <div className="text-xs text-gray-400">
                          Click to view details
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Footer */}
          <div className="border-t border-gray-200 px-4 py-2 bg-gray-50">
            <p className="text-xs text-gray-500 text-center">
              Use ↑↓ to navigate, Enter to select, Esc to close
            </p>
          </div>
        </div>
      )}

      {/* No Results */}
      {showDropdown && searchResults.length === 0 && !isSearching && searchTerm.trim() && (
        <div 
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50"
        >
          <div className="px-4 py-6 text-center">
            <IconChefHat size={24} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No menu items found for "{searchTerm}"</p>
            <p className="text-xs text-gray-400 mt-1">Try searching by menu item name</p>
          </div>
        </div>
      )}
    </div>
  );
}