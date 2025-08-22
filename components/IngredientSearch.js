// components/IngredientSearch.js
import React, { useState, useEffect, useRef } from 'react';
import supabase from '../lib/supabaseClient';
import {
  IconSearch,
  IconX,
  IconPackage,
  IconLoader,
  IconCalendar,
  IconCurrencyDollar,
  IconScale,
} from '@tabler/icons-react';

export default function IngredientSearch({ 
  restaurantId, 
  onIngredientSelect, 
  placeholder = "Search ingredients by name or unit...",
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
      // Search ingredients by name and unit
      const { data: ingredients, error } = await supabase
        .from('ingredients')
        .select('id, name, unit, last_price, last_ordered_at')
        .eq('restaurant_id', restaurantId)
        .or(`name.ilike.%${query}%,unit.ilike.%${query}%`)
        .order('name')
        .limit(10);

      if (error) {
        console.error('Search error:', error);
        setSearchResults([]);
        setShowDropdown(false);
        return;
      }

      const results = (ingredients || []).map(ingredient => ({
        id: ingredient.id,
        name: ingredient.name || 'Unnamed Ingredient',
        unit: ingredient.unit || 'No unit',
        price: ingredient.last_price,
        lastOrdered: ingredient.last_ordered_at,
        hasPrice: ingredient.last_price && parseFloat(ingredient.last_price) > 0,
        data: ingredient
      }));

      // Sort results by relevance (exact matches first, then by name)
      results.sort((a, b) => {
        const aNameMatch = a.name.toLowerCase().includes(query.toLowerCase());
        const bNameMatch = b.name.toLowerCase().includes(query.toLowerCase());
        const aUnitMatch = a.unit.toLowerCase().includes(query.toLowerCase());
        const bUnitMatch = b.unit.toLowerCase().includes(query.toLowerCase());
        
        // Prioritize name matches over unit matches
        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        if (aUnitMatch && !bUnitMatch) return -1;
        if (!aUnitMatch && bUnitMatch) return 1;
        
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
    if (!dateString) return "";
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return "";
    }
  }

  function handleResultClick(result) {
    setSearchTerm('');
    setShowDropdown(false);
    setSelectedIndex(-1);
    
    // Call the onIngredientSelect callback with the selected ingredient
    if (onIngredientSelect) {
      onIngredientSelect(result.data);
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
            {searchResults.map((result, index) => (
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
                    <IconPackage size={16} className="text-green-600" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-gray-900 truncate">
                          {result.name}
                        </h4>
                        <p className="text-xs text-gray-500 truncate flex items-center gap-1">
                          <IconScale size={12} />
                          {result.unit}
                        </p>
                      </div>
                      
                      <div className="flex-shrink-0 text-right ml-4">
                        <div className="text-sm font-medium text-gray-900 flex items-center gap-1">
                          <IconCurrencyDollar size={12} />
                          {result.hasPrice ? formatCurrency(result.price) : 'No price'}
                        </div>
                        {result.lastOrdered && (
                          <div className="text-xs text-gray-500 flex items-center gap-1">
                            <IconCalendar size={10} />
                            {formatDate(result.lastOrdered)}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${result.hasPrice ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className={`text-xs font-medium ${result.hasPrice ? 'text-green-700' : 'text-red-600'}`}>
                          {result.hasPrice ? 'Priced' : 'No price data'}
                        </span>
                      </div>
                      
                      <div className="text-xs text-gray-400">
                        Click to view details
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
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
            <IconPackage size={24} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No ingredients found for "{searchTerm}"</p>
            <p className="text-xs text-gray-400 mt-1">Try searching by ingredient name or unit type</p>
          </div>
        </div>
      )}
    </div>
  );
}