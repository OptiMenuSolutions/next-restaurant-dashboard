import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { generateForRestaurant } from '../ai-recommendations';
import { validateRecommendationConfig } from '../../../lib/ai/recommendationScoring';

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { restaurantId, scoringConfig } = req.body || {};

  if (
    typeof restaurantId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurantId)
  ) {
    return res.status(400).json({ error: 'Valid restaurantId is required' });
  }

  try {
    const now = new Date();

    const currentDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const dayOfWeek = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
    }).format(now);

    const diagnostics = {};
    const config = validateRecommendationConfig(scoringConfig || {});

    const recommendations = await generateForRestaurant(
      restaurantId,
      currentDate,
      dayOfWeek,
      {
        dryRun: true,
        diagnostics,
        scoringConfig: config,
      }
    );

    return res.status(200).json({
      dryRun: true,
      saved: false,
      date: currentDate,
      count: recommendations.length,
      recommendations,
      diagnostics,
    });
  } catch (error) {
    console.error('[test-ai-recommendations] Error:', error);

    return res.status(500).json({
      error: 'Recommendation dry run failed',
    });
  }
});