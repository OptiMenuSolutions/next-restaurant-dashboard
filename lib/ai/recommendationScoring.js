
export const DEFAULT_RECOMMENDATION_CONFIG = Object.freeze({
  inventoryWeight: 40,
  profitabilityWeight: 35,
  salesWeight: 25,
  shortlistSize: 12,
});

export function validateRecommendationConfig(input = {}) {
  const config = {
    ...DEFAULT_RECOMMENDATION_CONFIG,
    ...input,
  };

  const weights = [
    config.inventoryWeight,
    config.profitabilityWeight,
    config.salesWeight,
  ];

  if (
    weights.some(value =>
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    ) ||
    Math.abs(weights.reduce((sum, value) => sum + value, 0) - 100) > 0.000001
  ) {
    throw new Error('Recommendation weights must total 100%.');
  }

  if (
    !Number.isInteger(config.shortlistSize) ||
    config.shortlistSize < 3 ||
    config.shortlistSize > 25
  ) {
    throw new Error('Shortlist size must be between 3 and 25.');
  }

  return config;
}

function normalize(value, minimum, maximum) {
  if (!Number.isFinite(value)) return null;

  if (maximum <= minimum) {
    return 100;
  }

  return Math.max(
    0,
    Math.min(100, ((value - minimum) / (maximum - minimum)) * 100)
  );
}

function round(value) {
  return Math.round(value * 10) / 10;
}

export function scoreRecommendationCandidates(
  menuItems,
  inputConfig = DEFAULT_RECOMMENDATION_CONFIG
) {
  const config = validateRecommendationConfig(inputConfig);
  const items = Array.isArray(menuItems) ? menuItems : [];

  const profitValues = items
    .map(item => item.marginDollars)
    .filter(Number.isFinite);

  const marginValues = items
    .map(item => item.margin)
    .filter(Number.isFinite);

  const salesValues = items
    .map(item => item.qty7d)
    .filter(value => Number.isFinite(value) && value >= 0);

  const range = values => ({
    min: Math.min(...values),
    max: Math.max(...values),
  });

  const profitRange = profitValues.length ? range(profitValues) : null;
  const marginRange = marginValues.length ? range(marginValues) : null;
  const salesRange = salesValues.length ? range(salesValues) : null;

  const scored = items.map(item => {
    const expiring = (item.expiringIngredients || [])
      .filter(ingredient =>
        Number.isFinite(ingredient.daysLeft) &&
        ingredient.daysLeft > 0 &&
        ingredient.daysLeft <= 5
      );

    const distinctIngredients = [
      ...new Map(
        expiring
          .filter(ingredient => ingredient.ingredientId != null)
          .map(ingredient => [
            String(ingredient.ingredientId),
            ingredient,
          ])
      ).values(),
    ];

    // The most urgent verified ingredient drives the urgency score.
    // Multiple dishes sharing that ingredient do not create
    // independent inventory opportunities.
    const inventoryScore = distinctIngredients.length
      ? Math.max(
          ...distinctIngredients.map(ingredient =>
            ((6 - ingredient.daysLeft) / 5) * 100
          )
        )
      : null;

    const hasVerifiedProfit =
      Number.isFinite(item.margin) &&
      Number.isFinite(item.marginDollars);

    const profitabilityScore = hasVerifiedProfit &&
      profitRange &&
      marginRange
      ? (
          normalize(
            item.marginDollars,
            profitRange.min,
            profitRange.max
          ) +
          normalize(
            item.margin,
            marginRange.min,
            marginRange.max
          )
        ) / 2
      : null;

    const salesScore =
      Number.isFinite(item.qty7d) &&
      item.qty7d >= 0 &&
      salesRange
        ? normalize(
            item.qty7d,
            salesRange.min,
            salesRange.max
          )
        : null;

    const scores = {
      inventory: inventoryScore,
      profitability: profitabilityScore,
      sales: salesScore,
    };

    const configuredWeights = {
      inventory: config.inventoryWeight,
      profitability: config.profitabilityWeight,
      sales: config.salesWeight,
    };

    const availableWeight = Object.entries(scores)
      .reduce(
        (sum, [key, value]) =>
          sum + (value === null ? 0 : configuredWeights[key]),
        0
      );

    const effectiveWeights = {};
    const contributions = {};

    for (const key of Object.keys(scores)) {
      effectiveWeights[key] =
        scores[key] === null || availableWeight === 0
          ? 0
          : (configuredWeights[key] / availableWeight) * 100;

      contributions[key] =
        scores[key] === null
          ? 0
          : scores[key] * effectiveWeights[key] / 100;
    }

    const hasOperationalData = Object.values(scores)
      .some(value => value !== null);

    const totalScore = hasOperationalData
      ? Object.values(contributions)
          .reduce((sum, value) => sum + value, 0)
      : null;

    return {
      ...item,
      recommendationScoring: {
        scores: Object.fromEntries(
          Object.entries(scores).map(([key, value]) => [
            key,
            value === null ? null : round(value),
          ])
        ),
        effectiveWeights: Object.fromEntries(
          Object.entries(effectiveWeights).map(([key, value]) => [
            key,
            round(value),
          ])
        ),
        contributions: Object.fromEntries(
          Object.entries(contributions).map(([key, value]) => [
            key,
            round(value),
          ])
        ),
        totalScore: totalScore === null
          ? null
          : round(totalScore),
        mode: hasOperationalData ? 'data-backed' : 'menu-only',
        expiringIngredientIds: distinctIngredients.map(
          ingredient => String(ingredient.ingredientId)
        ),
      },
    };
  });

  scored.sort((a, b) => {
    const aScore = a.recommendationScoring.totalScore;
    const bScore = b.recommendationScoring.totalScore;

    if (aScore === null && bScore !== null) return 1;
    if (bScore === null && aScore !== null) return -1;

    return (
      (bScore ?? 0) - (aScore ?? 0) ||
      a.name.localeCompare(b.name)
    );
  });

  return {
    config,
    candidates: scored,
    shortlist: scored.slice(0, config.shortlistSize),
  };
}
