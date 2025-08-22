import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// Debug environment variables
console.log('=== ENVIRONMENT CHECK ===');
console.log('ANTHROPIC_API_KEY:', !!process.env.ANTHROPIC_API_KEY);
console.log('NEXT_PUBLIC_SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('SUPABASE_SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// More robust Supabase client creation
let supabase;
try {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing');
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing');
  }
  
  supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  console.log('Supabase client created successfully');
} catch (error) {
  console.error('Failed to create Supabase client:', error);
}

// Test Supabase connection
if (supabase) {
  try {
    console.log('Testing Supabase connection...');
    const { data, error } = await supabase.from('ai_recommendations').select('count').limit(1);
    if (error) {
      console.error('Supabase connection test failed:', error);
    } else {
      console.log('✅ Supabase connection test successful');
    }
  } catch (testError) {
    console.error('Supabase connection test error:', testError);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { dashboardData, restaurantId } = req.body;
    console.log('API called with restaurantId:', restaurantId);

    // Check if Supabase client was created successfully
    if (!supabase) {
      console.log('Supabase client not available, generating fresh recommendations');
      // Fall back to generating fresh recommendations without caching
      return await generateFreshRecommendations(dashboardData, res);
    }

    // Get current date in EST
    const now = new Date();
    const estDate = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
    const currentDate = estDate.toISOString().split('T')[0];
    
    console.log('Checking for cached recommendations for date:', currentDate);
    
    // Check if we already have recommendations for today
    const { data: existingRecs, error: fetchError } = await supabase
      .from('ai_recommendations')
      .select('recommendations')
      .eq('restaurant_id', restaurantId)
      .eq('generated_date', currentDate)
      .single();

    if (fetchError) {
      console.log('No cached recommendations found or error:', fetchError.message);
    }

    if (!fetchError && existingRecs) {
      console.log('Returning cached recommendations');
      return res.status(200).json({ 
        recommendations: existingRecs.recommendations,
        cached: true,
        date: currentDate
      });
    }

    console.log('Generating new recommendations');
    return await generateAndStoreRecommendations(dashboardData, restaurantId, currentDate, estDate, res);

  } catch (error) {
    console.error('Error in AI recommendations API:', error);
    res.status(500).json({ 
      message: 'Error generating recommendations',
      error: error.message 
    });
  }
}

// Helper function to generate fresh recommendations without caching
async function generateFreshRecommendations(dashboardData, res) {
  const prompt = `You are an AI restaurant consultant. Provide exactly 3 actionable daily recommendations.

RESTAURANT DATA:
- Total Menu Items: ${dashboardData.totalMenuItems || 0}
- Average Margin: ${dashboardData.averageMargin?.toFixed(1) || 0}%

Return EXACTLY this JSON format:
{
  "recommendations": [
    {
      "title": "Action Title",
      "description": "Brief explanation", 
      "type": "promote",
      "color": "green"
    },
    {
      "title": "Second Action",
      "description": "Brief explanation",
      "type": "alert", 
      "color": "orange"
    },
    {
      "title": "Third Action",
      "description": "Brief explanation",
      "type": "optimize",
      "color": "red"
    }
  ]
}`;

  const message = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }]
  });

  const responseText = message.content[0].text;
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  const aiResponse = JSON.parse(jsonMatch[0]);
  
  return res.status(200).json({
    recommendations: aiResponse.recommendations,
    cached: false,
    note: "Generated without caching"
  });
}

// Helper function to generate and store recommendations
async function generateAndStoreRecommendations(dashboardData, restaurantId, currentDate, estDate, res) {
  // Your full prompt here
  const prompt = `You are an AI restaurant consultant analyzing data for this restaurant. Based on the comprehensive data below, provide exactly 3 actionable daily recommendations for ${currentDate}.

RESTAURANT DATA:
- Total Menu Items: ${dashboardData.totalMenuItems}
- Average Margin: ${dashboardData.averageMargin?.toFixed(1)}%

MENU ANALYSIS:
${dashboardData.menuItemAnalysis?.slice(0, 5).map(item => 
  `- ${item.name}: $${item.price} (${item.margin?.toFixed(1)}% margin)`
).join('\n')}

Current Date: ${currentDate}
Day of Week: ${estDate.toLocaleDateString('en-US', { weekday: 'long' })}

INSTRUCTIONS:
Return EXACTLY 3 recommendations in this JSON format:
{
  "recommendations": [
    {
      "title": "Action Title (max 25 chars)",
      "description": "Brief explanation (max 45 chars)", 
      "type": "promote|optimize|alert",
      "color": "green|orange|red"
    }
  ]
}`;

  const message = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1000,
    temperature: 0.7,
    messages: [{ role: "user", content: prompt }]
  });

  const responseText = message.content[0].text;
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  const aiResponse = JSON.parse(jsonMatch[0]);
  
  // Try to store recommendations
    try {
    console.log('Attempting to store recommendations for restaurant:', restaurantId);
    console.log('Data to store:', {
        restaurant_id: restaurantId,
        generated_date: currentDate,
        recommendations: aiResponse.recommendations
    });

    const { data, error: insertError } = await supabase
        .from('ai_recommendations')
        .upsert({
        restaurant_id: restaurantId,
        generated_date: currentDate,
        recommendations: aiResponse.recommendations
        })
        .select(); // Add .select() to see what was inserted

    if (insertError) {
        console.error('Insert error details:', insertError);
    } else {
        console.log('Successfully stored recommendations:', data);
    }
    } catch (storeError) {
    console.error('Failed to store recommendations:', storeError);
    }

  return res.status(200).json({
    recommendations: aiResponse.recommendations,
    cached: false,
    date: currentDate
  });
}