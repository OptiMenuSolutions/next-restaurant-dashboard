
import { convertIngredientQuantity } from './ingredientUnitConversions';

/**
 * Calculate an ingredient's recipe cost using its saved unit conversions.
 *
 * Returns null when the conversion cannot be established.
 * The ingredient must include its conversion relationships from Supabase.
 *
 * Estimated conversions are not treated as verified.
 */
export function calculateVerifiedIngredientCost(
  recipeQuantity,
  recipeUnit,
  ingredient
) {
  const quantity = Number(recipeQuantity);
  const unitCost = Number(ingredient?.last_price);

  if (
    !ingredient ||
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    !Number.isFinite(unitCost) ||
    unitCost < 0 ||
    !recipeUnit ||
    !ingredient.unit
  ) {
    return null;
  }

  const conversion = convertIngredientQuantity(
    quantity,
    recipeUnit,
    ingredient.unit,
    ingredient
  );

  if (
    !conversion ||
    conversion.estimated ||
    !Number.isFinite(conversion.quantity)
  ) {
    return null;
  }

  return conversion.quantity * unitCost;
}
