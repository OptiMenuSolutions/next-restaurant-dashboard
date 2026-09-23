// File: lib/standardizedUnits.js
// (Corrected from this file's own original header, which said
// src/utils/standardizedUnits.js — confirm-invoice.js imports it from
// '../../../lib/standardizedUnits', so it must live at lib/standardizedUnits.js
// in the actual repo, or that import will throw a module-not-found error.)
// Enhanced unit standardization system with better normalization and error handling

// Standard base units for different categories
const STANDARD_UNITS = {
  WEIGHT: 'oz',     // ounces for all weight-based units
  VOLUME: 'fl oz',  // fluid ounces for all volume-based units
  COUNT: 'each',    // each for countable items
};

// Comprehensive unit normalization map
const UNIT_NORMALIZATION = {
  // Weight variations
  'g': 'g',
  'gram': 'g',
  'grams': 'g',
  'oz': 'oz',
  'ounce': 'oz',
  'ounces': 'oz',
  'lb': 'lb',
  'lbs': 'lb',
  'pound': 'lb',
  'pounds': 'lb',
  'kg': 'kg',
  'kilogram': 'kg',
  'kilograms': 'kg',

  // Volume variations
  'ml': 'ml',
  'milliliter': 'ml',
  'milliliters': 'ml',
  'fl oz': 'fl oz',
  'floz': 'fl oz',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
  'tbsp': 'tbsp',
  'tablespoon': 'tbsp',
  'tablespoons': 'tbsp',
  'tsp': 'tsp',
  'teaspoon': 'tsp',
  'teaspoons': 'tsp',
  'cup': 'cup',
  'cups': 'cup',
  'gallon': 'gal',
  'gallons': 'gal',
  'gal': 'gal',
  'liter': 'l',
  'liters': 'l',
  'l': 'l',
  'litre': 'l',
  'litres': 'l',
  'can': 'can',
  '#10': 'can',
  '#10 can': 'can',

  // Count variations
  'each': 'each',
  'piece': 'each',
  'pieces': 'each',
  'item': 'each',
  'items': 'each',
  'whole': 'each',
  'ct': 'each',
  'count': 'each',

  // Special variations
  'clove': 'clove',
  'cloves': 'clove',

};

// Unit categorization based on normalized units
const UNIT_CATEGORIES = {
  // Weight units
  'g': 'weight',
  'oz': 'weight',
  'lb': 'weight',
  'kg': 'weight',

  // Volume units
  'ml': 'volume',
  'fl oz': 'volume',
  'tbsp': 'volume',
  'tsp': 'volume',
  'cup': 'volume',
  'gal': 'volume',
  'l': 'volume',
  'can': 'volume',

  // Count units
  'each': 'count',
  'ct': 'count',
  'count': 'count',

  // Special ingredient-specific units
  'clove': 'special',
  'bunch': 'count',
};

// Conversion factors to standard units (using normalized unit names)
const TO_STANDARD_WEIGHT = {
  'g': 0.035274,        // grams to ounces
  'oz': 1,              // ounces (already standard)
  'lb': 16,             // pounds to ounces
  'kg': 35.274,         // kilograms to ounces
};

const TO_STANDARD_VOLUME = {
  'ml': 0.033814,       // milliliters to fluid ounces
  'fl oz': 1,           // fluid ounces (already standard)
  'tbsp': 0.5,          // tablespoons to fluid ounces
  'tsp': 0.166667,      // teaspoons to fluid ounces
  'cup': 8,             // cups to fluid ounces
  'gal': 128,           // gallons to fluid ounces
  'l': 33.814,          // liters to fluid ounces
  'can': 109,           // #10 can ≈ 109 fl oz
};

// Special conversions for ingredient-specific units
const SPECIAL_UNIT_CONVERSIONS = {
  'clove': { standardUnit: 'oz', conversionFactor: 0.1 }, // 1 clove ≈ 0.1 oz
};

// Ingredient-specific density conversions (volume to weight)
// These handle cases where recipes use volume but ingredients are purchased by weight
const INGREDIENT_DENSITY_CONVERSIONS = {
  // Salt conversions (tsp/tbsp to weight)
  'salt': {
    'tsp': { standardUnit: 'oz', conversionFactor: 0.2 }, // 1 tsp salt ≈ 0.2 oz
    'tbsp': { standardUnit: 'oz', conversionFactor: 0.6 }, // 1 tbsp salt ≈ 0.6 oz
    'teaspoon': { standardUnit: 'oz', conversionFactor: 0.2 },
    'tablespoon': { standardUnit: 'oz', conversionFactor: 0.6 },
    'teaspoons': { standardUnit: 'oz', conversionFactor: 0.2 },
    'tablespoons': { standardUnit: 'oz', conversionFactor: 0.6 },
  },
  
  // Black pepper conversions (tsp/tbsp to weight)
  'black pepper': {
    'tsp': { standardUnit: 'oz', conversionFactor: 0.07 }, // 1 tsp pepper ≈ 0.07 oz
    'tbsp': { standardUnit: 'oz', conversionFactor: 0.21 }, // 1 tbsp pepper ≈ 0.21 oz
    'teaspoon': { standardUnit: 'oz', conversionFactor: 0.07 },
    'tablespoon': { standardUnit: 'oz', conversionFactor: 0.21 },
    'teaspoons': { standardUnit: 'oz', conversionFactor: 0.07 },
    'tablespoons': { standardUnit: 'oz', conversionFactor: 0.21 },
  },
  
  // Pepper (generic)
  'pepper': {
    'tsp': { standardUnit: 'oz', conversionFactor: 0.07 },
    'tbsp': { standardUnit: 'oz', conversionFactor: 0.21 },
    'teaspoon': { standardUnit: 'oz', conversionFactor: 0.07 },
    'tablespoon': { standardUnit: 'oz', conversionFactor: 0.21 },
    'teaspoons': { standardUnit: 'oz', conversionFactor: 0.07 },
    'tablespoons': { standardUnit: 'oz', conversionFactor: 0.21 },
  },
  
  // Add more ingredients as needed
  'sugar': {
    'tsp': { standardUnit: 'oz', conversionFactor: 0.15 }, // 1 tsp sugar ≈ 0.15 oz
    'tbsp': { standardUnit: 'oz', conversionFactor: 0.45 }, // 1 tbsp sugar ≈ 0.45 oz
    'cup': { standardUnit: 'oz', conversionFactor: 7.0 },   // 1 cup sugar ≈ 7 oz
    'teaspoon': { standardUnit: 'oz', conversionFactor: 0.15 },
    'tablespoon': { standardUnit: 'oz', conversionFactor: 0.45 },
    'cups': { standardUnit: 'oz', conversionFactor: 7.0 },
  },
  
  'flour': {
    'tsp': { standardUnit: 'oz', conversionFactor: 0.1 },  // 1 tsp flour ≈ 0.1 oz
    'tbsp': { standardUnit: 'oz', conversionFactor: 0.3 }, // 1 tbsp flour ≈ 0.3 oz
    'cup': { standardUnit: 'oz', conversionFactor: 4.5 },  // 1 cup flour ≈ 4.5 oz
    'teaspoon': { standardUnit: 'oz', conversionFactor: 0.1 },
    'tablespoon': { standardUnit: 'oz', conversionFactor: 0.3 },
    'cups': { standardUnit: 'oz', conversionFactor: 4.5 },
  }
};

// new — add near the existing INGREDIENT_DENSITY_CONVERSIONS
// Broad density estimates (oz of weight per fl oz of volume), for
// bridging a weight<->volume mismatch when there's no exact per-ingredient
// factor above. Matched by keyword, most specific category first. These
// are estimates, not precise — appropriate for the kind of ingredient
// this actually applies to (garnishes, condiments, small pours), which
// contribute a few cents to a dish either way. Falls back to 1.0 (water's
// density) for anything unrecognized, rather than refusing to estimate.
const DENSITY_CATEGORY_KEYWORDS = [
  // Oils — lighter than water
  { keywords: ['oil', 'olive oil', 'vegetable oil', 'canola', 'sesame oil'], ozPerFlOz: 0.92 },
  // Honey, syrup, molasses — notably heavier than water
  { keywords: ['honey', 'syrup', 'molasses', 'agave'], ozPerFlOz: 1.42 },
  // Dairy liquids — close to water, cream a touch lighter
  { keywords: ['heavy cream', 'cream'], ozPerFlOz: 1.0 },
  { keywords: ['milk', 'buttermilk', 'half and half'], ozPerFlOz: 1.03 },
  // Thick condiments and dressings — mayo, ketchup, bbq sauce, dressing,
  // gravy, mustard — slightly denser than water
  { keywords: ['mayo', 'mayonnaise', 'ketchup', 'mustard', 'bbq sauce',
               'dressing', 'gravy', 'tartar', 'aioli', 'hot sauce', 'salsa'], ozPerFlOz: 1.08 },
  // Thin liquids — vinegar, wine, stock, broth, juice — very close to water
  { keywords: ['vinegar', 'wine', 'stock', 'broth', 'juice', 'water'], ozPerFlOz: 1.02 },
];

function estimateDensity(ingredientName) {
  const lower = (ingredientName || '').toLowerCase();
  for (const { keywords, ozPerFlOz } of DENSITY_CATEGORY_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return ozPerFlOz;
  }
  return 1.0; // water's density — a reasonable default for an unrecognized liquid
}

/**
 * Converts a weight<->volume mismatch using an estimated density, when no
 * exact per-ingredient factor exists in INGREDIENT_DENSITY_CONVERSIONS.
 * Only called when the two categories genuinely differ (weight vs. volume) —
 * count-category mismatches (e.g. "3 each" vs. a weight price) still can't
 * be bridged this way and are left to the caller to handle.
 *
 * @returns {{quantity: number, unit: string}} qty converted into toUnit's
 *   own standard unit (oz or fl oz)
 */
function convertAcrossCategoriesByDensity(quantity, fromUnit, toCategory, ingredientName) {
  const fromCategory = getUnitCategory(fromUnit);
  const fromStandard = convertToStandardUnit(quantity, fromUnit, ingredientName);
  const density = estimateDensity(ingredientName); // oz per fl oz

  if (fromCategory === 'volume' && toCategory === 'weight') {
    // fromStandard.quantity is in fl oz; convert to oz via density
    return { quantity: fromStandard.quantity * density, unit: STANDARD_UNITS.WEIGHT };
  }
  if (fromCategory === 'weight' && toCategory === 'volume') {
    // fromStandard.quantity is in oz; convert to fl oz via density
    return { quantity: fromStandard.quantity / density, unit: STANDARD_UNITS.VOLUME };
  }
  return null; // not a weight<->volume mismatch — density doesn't apply
}

/**
 * Normalize a unit string to its canonical form
 * @param {string} unit - The unit to normalize
 * @returns {string} - Normalized unit
 */
function normalizeUnit(unit) {
  if (!unit) return 'each';
  
  const cleaned = unit.toLowerCase().trim().replace(/\./g, '');
  const normalized = UNIT_NORMALIZATION[cleaned];
  
  if (!normalized) {
    console.warn(`⚠️ Unknown unit "${unit}" - using as-is`);
    return cleaned;
  }
  
  return normalized;
}

/**
 * Check for ingredient-specific density conversion
 * @param {string} ingredientName - Name of the ingredient
 * @param {string} unit - Unit to convert from
 * @returns {object|null} - Conversion data or null if no specific conversion exists
 */
function getIngredientSpecificConversion(ingredientName, unit) {
  if (!ingredientName) return null;
  
  const normalizedIngredientName = ingredientName.toLowerCase().trim();
  const normalizedUnit = normalizeUnit(unit);
  
  // Check for exact ingredient name match
  if (INGREDIENT_DENSITY_CONVERSIONS[normalizedIngredientName]) {
    const ingredientConversions = INGREDIENT_DENSITY_CONVERSIONS[normalizedIngredientName];
    if (ingredientConversions[normalizedUnit]) {
      return ingredientConversions[normalizedUnit];
    }
  }
  
  // Check for partial matches (e.g., "sea salt" matches "salt")
  for (const [ingredientKey, conversions] of Object.entries(INGREDIENT_DENSITY_CONVERSIONS)) {
    if (normalizedIngredientName.includes(ingredientKey) || ingredientKey.includes(normalizedIngredientName)) {
      if (conversions[normalizedUnit]) {
        console.log(`🔄 Found ingredient-specific conversion for "${ingredientName}" (matched "${ingredientKey}")`);
        return conversions[normalizedUnit];
      }
    }
  }
  
  return null;
}

/**
 * Determine the category of a unit
 * @returns {string} - 'weight', 'volume', 'count', or 'special'
 */
export function getUnitCategory(unit) {
  const normalizedUnit = normalizeUnit(unit);
  
  if (UNIT_CATEGORIES[normalizedUnit]) {
    return UNIT_CATEGORIES[normalizedUnit];
  }
  
  // Default to weight for unknown units (safest assumption)
  console.warn(`⚠️ Unknown unit category for "${unit}". Defaulting to weight.`);
  return 'weight';
}

/**
 * Get the standard unit for a given unit (based on its category)
 * @param {string} unit - The unit to get standard unit for
 * @returns {string} - Standard unit ('oz', 'fl oz', or 'each')
 */
export function getStandardUnitForUnit(unit) {
  const category = getUnitCategory(unit);
  
  switch (category) {
    case 'weight':
      return STANDARD_UNITS.WEIGHT;
    case 'volume':
      return STANDARD_UNITS.VOLUME;
    case 'count':
      return STANDARD_UNITS.COUNT;
    case 'special':
      // For special units, check the conversion table
      const normalizedUnit = normalizeUnit(unit);
      if (SPECIAL_UNIT_CONVERSIONS[normalizedUnit]) {
        return SPECIAL_UNIT_CONVERSIONS[normalizedUnit].standardUnit;
      }
      return STANDARD_UNITS.WEIGHT; // fallback
    default:
      return STANDARD_UNITS.WEIGHT;
  }
}

/**
 * Convert any unit to its standard unit
 * @param {number} quantity - Quantity to convert
 * @param {string} fromUnit - Unit to convert from
 * @param {string} ingredientName - Name of ingredient (for density conversions)
 * @returns {object} - { quantity: number, unit: string, success: boolean, category: string }
 */
export function convertToStandardUnit(quantity, fromUnit, ingredientName = '') {
  const normalizedUnit = normalizeUnit(fromUnit);
  
  // First check for ingredient-specific density conversions
  if (ingredientName) {
    const specificConversion = getIngredientSpecificConversion(ingredientName, normalizedUnit);
    if (specificConversion) {
      console.log(`🥄 Using ingredient-specific conversion for ${ingredientName}: ${quantity} ${fromUnit} → ${specificConversion.standardUnit}`);
      
      const convertedQuantity = quantity * specificConversion.conversionFactor;
      
      console.log(`✅ Ingredient-specific conversion: ${quantity} ${fromUnit} → ${convertedQuantity.toFixed(6)} ${specificConversion.standardUnit}`);
      
      return {
        quantity: convertedQuantity,
        unit: specificConversion.standardUnit,
        success: true,
        category: 'ingredient-specific',
        conversionFactor: specificConversion.conversionFactor,
        originalUnit: fromUnit,
        normalizedUnit,
        conversionType: 'density'
      };
    }
  }
  
  // Continue with normal unit conversion logic
  const category = getUnitCategory(normalizedUnit);
  const standardUnit = getStandardUnitForUnit(normalizedUnit);
  
  console.log(`🔄 Converting ${quantity} ${fromUnit} → ${normalizedUnit} (category: ${category}) → ${standardUnit}`);
  
  // If already in standard unit, return as-is
  if (normalizedUnit === standardUnit || fromUnit === standardUnit) {
    console.log(`✅ Already in standard unit: ${quantity} ${standardUnit}`);
    return { 
      quantity, 
      unit: standardUnit, 
      success: true, 
      category,
      conversionFactor: 1,
      originalUnit: fromUnit,
      normalizedUnit
    };
  }
  
  try {
    let convertedQuantity = quantity;
    let conversionFactor = 1;
    
    switch (category) {
      case 'weight':
        if (TO_STANDARD_WEIGHT[normalizedUnit]) {
          conversionFactor = TO_STANDARD_WEIGHT[normalizedUnit];
          convertedQuantity = quantity * conversionFactor;
        } else {
          throw new Error(`Unknown weight unit: ${normalizedUnit}`);
        }
        break;
        
      case 'volume':
        if (TO_STANDARD_VOLUME[normalizedUnit]) {
          conversionFactor = TO_STANDARD_VOLUME[normalizedUnit];
          convertedQuantity = quantity * conversionFactor;
        } else {
          throw new Error(`Unknown volume unit: ${normalizedUnit}`);
        }
        break;
        
      case 'count':
        // Count units don't convert
        convertedQuantity = quantity;
        conversionFactor = 1;
        break;
        
      case 'special':
        if (SPECIAL_UNIT_CONVERSIONS[normalizedUnit]) {
          conversionFactor = SPECIAL_UNIT_CONVERSIONS[normalizedUnit].conversionFactor;
          convertedQuantity = quantity * conversionFactor;
        } else {
          throw new Error(`Unknown special unit: ${normalizedUnit}`);
        }
        break;
        
      default:
        throw new Error(`Unknown unit category for: ${normalizedUnit}`);
    }
    
    console.log(`✅ Converted: ${quantity} ${fromUnit} → ${convertedQuantity.toFixed(6)} ${standardUnit} (factor: ${conversionFactor})`);
    
    return {
      quantity: convertedQuantity,
      unit: standardUnit,
      success: true,
      category,
      conversionFactor,
      originalUnit: fromUnit,
      normalizedUnit
    };
    
  } catch (error) {
    console.error(`❌ Conversion failed: ${error.message}`);
    return {
      quantity: quantity,
      unit: fromUnit,
      success: false,
      category,
      error: error.message,
      originalUnit: fromUnit,
      normalizedUnit
    };
  }
}

/**
 * Calculate cost using standardized units
 * @param {number} recipeQuantity - Quantity needed in recipe
 * @param {string} recipeUnit - Unit used in recipe
 * @param {number} ingredientStandardCost - Cost per standard unit from ingredients table
 * @param {string} ingredientName - Name of ingredient (for debugging and density conversions)
 * @returns {number} - The calculated cost
 */
export function calculateStandardizedCost(recipeQuantity, recipeUnit, ingredientCost, ingredientUnit, ingredientName = '') {
  if (!ingredientCost || ingredientCost === 0) return 0;

  const normalizedRecipeUnit = normalizeUnit(recipeUnit);
  const normalizedIngredientUnit = normalizeUnit(ingredientUnit);

  // Same unit — no conversion needed
  if (normalizedRecipeUnit === normalizedIngredientUnit) {
    return recipeQuantity * ingredientCost;
  }

  const recipeCategory = getUnitCategory(normalizedRecipeUnit);
  const ingredientCategory = getUnitCategory(normalizedIngredientUnit);

  // A genuine weight<->volume mismatch — bridge it with an estimated
  // density rather than refusing. Appropriate here specifically because
  // this only ever fires on the kind of ingredient (a condiment, a pour,
  // a garnish) where a density estimate's small margin of error amounts
  // to a few cents on the dish, not a meaningful cost swing — proteins
  // and other big-dollar items are purchased and recipe'd in matching
  // weight units in the first place, so they never hit this path.
  if (
    (recipeCategory === 'volume' && ingredientCategory === 'weight') ||
    (recipeCategory === 'weight' && ingredientCategory === 'volume')
  ) {
    const bridged = convertAcrossCategoriesByDensity(recipeQuantity, normalizedRecipeUnit, ingredientCategory, ingredientName);
    const ingredientInStandard = convertToStandardUnit(1, normalizedIngredientUnit, ingredientName);
    if (bridged && ingredientInStandard.success) {
      return (bridged.quantity / ingredientInStandard.quantity) * ingredientCost;
    }
  }

  // Convert recipe quantity to ingredient's unit
  // e.g. recipe says 8 oz, ingredient priced per lb → convert 8 oz to 0.5 lb
  const toStandard = convertToStandardUnit(recipeQuantity, recipeUnit, ingredientName);
  const ingredientInStandard = convertToStandardUnit(1, ingredientUnit, ingredientName);

  // Both conversions can "succeed" into DIFFERENT categories (e.g. 1.5 lb → 24 oz,
  // 1 each → 1 each) — dividing those produced nonsense like 24 × $3.10 for ribs.
  // Weight↔volume was already handled above via density, so any other category
  // difference here is a genuine count↔weight/volume mismatch.
  const weightVolumePair =
    (recipeCategory === 'weight' && ingredientCategory === 'volume') ||
    (recipeCategory === 'volume' && ingredientCategory === 'weight');
  const crossCategory = recipeCategory !== ingredientCategory && !weightVolumePair;

  if (!toStandard.success || !ingredientInStandard.success || crossCategory) {
    // Genuinely incompatible (e.g. count vs. weight, with no per-item
    // weight known) — density doesn't apply here. Fall back to simple
    // multiply as a last resort, same as before.
    console.warn(`Unit mismatch: recipe=${recipeUnit}, ingredient=${ingredientUnit}. Falling back.`);
    return recipeQuantity * ingredientCost;
  }

  // Both converted to the same standard unit — now we can divide
  const recipeInStandardQty = toStandard.quantity;
  const ingredientInStandardQty = ingredientInStandard.quantity;

  // cost = (recipeQty in standard) / (1 ingredientUnit in standard) * ingredientCost
  return (recipeInStandardQty / ingredientInStandardQty) * ingredientCost;
}

export function hasUnitMismatch(recipeUnit, ingredientUnit) {
  const r = getUnitCategory(normalizeUnit(recipeUnit));
  const i = getUnitCategory(normalizeUnit(ingredientUnit));
  if (r === i) return false;
  const weightVolumePair = (r === 'weight' && i === 'volume') || (r === 'volume' && i === 'weight');
  return !weightVolumePair;
}

/**
 * Convert invoice data to standardized format for storage
 * @param {string} itemName - Name of the ingredient from invoice
 * @param {number} totalCost - Total cost of the line item
 * @param {number} quantity - Quantity purchased
 * @param {string} unit - Unit from invoice
 * @returns {object} - Standardized ingredient data
 */
export function standardizeInvoiceItem(itemName, totalCost, quantity, unit) {
  console.log(`\n📦 Standardizing invoice item: ${itemName}`);
  console.log(`Invoice data: ${quantity} ${unit} for ${totalCost.toFixed(2)}`);
  
  const unitCost = totalCost / quantity;
  console.log(`Unit cost: ${unitCost.toFixed(4)} per ${unit}`);
  
  // Convert to standard unit (pass ingredient name for density conversions)
  const conversion = convertToStandardUnit(quantity, unit, itemName);
  
  if (!conversion.success) {
    console.error(`❌ Failed to standardize ${itemName}: ${conversion.error}`);
    console.log(`⚠️ Using fallback: storing as ${unitCost.toFixed(4)} per ${unit}`);
    
    return {
      name: itemName,
      standardUnit: unit, // Keep original unit as fallback
      standardCost: unitCost, // Use original unit cost
      success: false,
      error: conversion.error,
      originalQuantity: quantity,
      originalUnit: unit,
      originalUnitCost: unitCost,
      fallback: true
    };
  }
  
  const standardUnitCost = totalCost / conversion.quantity;
  
  console.log(`✅ Standardized: ${standardUnitCost.toFixed(4)} per ${conversion.unit}`);
  console.log(`Conversion details: ${quantity} ${unit} → ${conversion.quantity.toFixed(6)} ${conversion.unit}`);
  if (conversion.conversionType === 'density') {
    console.log(`🥄 Used ingredient-specific density conversion`);
  }
  
  return {
    name: itemName,
    standardUnit: conversion.unit,
    standardCost: standardUnitCost,
    originalQuantity: quantity,
    originalUnit: unit,
    originalUnitCost: unitCost,
    standardQuantity: conversion.quantity,
    category: conversion.category,
    conversionFactor: conversion.conversionFactor,
    conversionType: conversion.conversionType,
    success: true
  };
}

/**
 * Get all available input units grouped by category
 * @returns {object} - Available units grouped by category
 */
export function getAvailableInputUnits() {
  const weightUnits = Object.keys(TO_STANDARD_WEIGHT);
  const volumeUnits = Object.keys(TO_STANDARD_VOLUME);
  const countUnits = ['each'];
  const specialUnits = Object.keys(SPECIAL_UNIT_CONVERSIONS);
  
  return {
    weight: weightUnits,
    volume: volumeUnits,
    count: countUnits,
    special: specialUnits,
    all: [...weightUnits, ...volumeUnits, ...countUnits, ...specialUnits]
  };
}

/**
 * Validate if a unit is supported
 * @param {string} unit - Unit to validate
 * @returns {object} - Validation result
 */
export function validateUnit(unit) {
  const normalizedUnit = normalizeUnit(unit);
  const category = getUnitCategory(normalizedUnit);
  const standardUnit = getStandardUnitForUnit(normalizedUnit);
  const conversion = convertToStandardUnit(1, unit);
  
  return {
    valid: conversion.success,
    category: category,
    standardUnit: standardUnit,
    normalizedUnit: normalizedUnit,
    supported: UNIT_CATEGORIES[normalizedUnit] !== undefined,
    message: conversion.success ? 
      `✅ ${unit} → ${normalizedUnit} (${category}) converts to ${standardUnit}` : 
      `❌ ${conversion.error}`
  };
}

/**
 * Get unit suggestions based on partial input
 * @param {string} partialUnit - Partial unit string
 * @param {number} maxSuggestions - Maximum number of suggestions
 * @returns {Array} - Array of suggested units with descriptions
 */
export function getUnitSuggestions(partialUnit, maxSuggestions = 10) {
  const searchTerm = partialUnit.toLowerCase().trim();
  
  // Get all possible input variations
  const allInputUnits = Object.keys(UNIT_NORMALIZATION);
  
  // Find matching units
  const matches = allInputUnits
    .filter(unit => unit.toLowerCase().includes(searchTerm))
    .slice(0, maxSuggestions)
    .map(unit => {
      const normalizedUnit = normalizeUnit(unit);
      const category = getUnitCategory(normalizedUnit);
      const standardUnit = getStandardUnitForUnit(normalizedUnit);
      return {
        unit,
        normalizedUnit,
        category,
        standardUnit,
        description: getUnitDescription(unit, category)
      };
    });
  
  return matches;
}

/**
 * Get description for a unit
 * @param {string} unit - Unit to describe
 * @param {string} category - Unit category (optional)
 * @returns {string} - Unit description
 */
function getUnitDescription(unit, category = null) {
  if (!category) {
    category = getUnitCategory(unit);
  }
  
  const descriptions = {
    // Weight
    'g': 'grams (weight)',
    'gram': 'grams (weight)',
    'grams': 'grams (weight)',
    'oz': 'ounces (weight)',
    'ounce': 'ounces (weight)',
    'ounces': 'ounces (weight)',
    'lb': 'pounds (weight)',
    'lbs': 'pounds (weight)',
    'pound': 'pounds (weight)',
    'pounds': 'pounds (weight)',
    'kg': 'kilograms (weight)',
    'kilogram': 'kilograms (weight)',
    'kilograms': 'kilograms (weight)',
    
    // Volume
    'ml': 'milliliters (volume)',
    'milliliter': 'milliliters (volume)',
    'milliliters': 'milliliters (volume)',
    'fl oz': 'fluid ounces (volume)',
    'fluid ounce': 'fluid ounces (volume)',
    'fluid ounces': 'fluid ounces (volume)',
    'tbsp': 'tablespoons (volume)',
    'tablespoon': 'tablespoons (volume)',
    'tablespoons': 'tablespoons (volume)',
    'tsp': 'teaspoons (volume)',
    'teaspoon': 'teaspoons (volume)',
    'teaspoons': 'teaspoons (volume)',
    'cup': 'cups (volume)',
    'cups': 'cups (volume)',
    'gal': 'gallons (volume)',
    'gallon': 'gallons (volume)',
    'gallons': 'gallons (volume)',
    'l': 'liters (volume)',
    'liter': 'liters (volume)',
    'liters': 'liters (volume)',
    
    // Count
    'each': 'individual items',
    'piece': 'individual pieces',
    'pieces': 'individual pieces',
    'item': 'individual items',
    'items': 'individual items',
    'whole': 'whole items',
    
    // Special
    'clove': 'garlic cloves',
    'cloves': 'garlic cloves',
    'bunch': 'bunch',
    'bunches': 'bunch',
  };
  
  return descriptions[unit.toLowerCase()] || `${unit} (${category})`;
}

// Export constants for use in components
export {
  STANDARD_UNITS,
  UNIT_CATEGORIES,
  TO_STANDARD_WEIGHT,
  TO_STANDARD_VOLUME,
  SPECIAL_UNIT_CONVERSIONS,
  normalizeUnit,
  convertAcrossCategoriesByDensity,
};

/**
 * Convert an invoice unit cost to cost-per-standard-unit (oz or fl oz).
 * This is what should be stored in ingredients.last_price.
 * 
 * @param {number} invoiceUnitCost  - e.g. 3.50 (per lb)
 * @param {string} invoiceUnit      - e.g. 'lb'
 * @param {string} ingredientName   - for density lookups
 * @returns {number} - cost per standard unit (oz or fl oz)
 */
export function convertInvoiceCostToStandardUnit(invoiceUnitCost, invoiceUnit, ingredientName = '') {
  // Convert 1 unit of the invoice unit to standard units
  // e.g. 1 lb = 16 oz, so $3.50/lb ÷ 16 = $0.21875/oz
  const conversion = convertToStandardUnit(1, invoiceUnit, ingredientName);
  if (!conversion.success || conversion.quantity === 0) {
    // Can't convert — return as-is (will be inaccurate but won't crash)
    return invoiceUnitCost;
  }
  // invoiceUnitCost is per invoiceUnit
  // conversion.quantity is how many standard units are in 1 invoiceUnit
  // so cost per standard unit = invoiceUnitCost / conversion.quantity
  return invoiceUnitCost / conversion.quantity;
}

/**
 * Get the standard unit for an ingredient based on its invoice unit.
 * Stored alongside last_price so we know what unit the price is per.
 */
export function getStandardUnitForIngredient(invoiceUnit, ingredientName = '') {
  const conversion = convertToStandardUnit(1, invoiceUnit, ingredientName);
  return conversion.success ? conversion.unit : invoiceUnit;
}
