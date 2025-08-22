// lib/activityLogger.js
import supabase from './supabaseClient';

export async function logActivity({
  activityType,
  title,
  subtitle = null,
  details = null,
  restaurantId = null,
  restaurantName = null,
  metadata = {}
}) {
  try {
    // Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError) {
      console.error('Error getting user for activity log:', userError);
      return;
    }

    if (!user) {
      console.warn('No authenticated user found for activity logging');
      return;
    }

    console.log('Logging activity:', { activityType, title, user: user.id });

    const activityData = {
      activity_type: activityType,
      title,
      subtitle,
      details,
      restaurant_id: restaurantId,
      restaurant_name: restaurantName,
      user_id: user.id,
      metadata: metadata || {},
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('activity_logs')
      .insert([activityData])
      .select();

    if (error) {
      console.error('Error inserting activity log:', error);
      console.error('Activity data that failed:', activityData);
      
      // Check if it's an RLS policy error
      if (error.code === '42501' || error.message.includes('policy')) {
        console.error('This appears to be an RLS policy error. Make sure you have the correct policies set up on the activity_logs table.');
      }
    } else {
      console.log('Activity logged successfully:', data);
    }
  } catch (error) {
    console.error('Unexpected error in logActivity:', error);
  }
}

// Test function to verify activity logging is working
export async function testActivityLogging() {
  console.log('Testing activity logging...');
  
  await logActivity({
    activityType: ACTIVITY_TYPES.INVOICE_CREATED,
    title: 'Test activity log',
    subtitle: 'This is a test',
    details: 'Testing if activity logging is working properly',
    metadata: { test: true }
  });
}

// Activity type constants
export const ACTIVITY_TYPES = {
  PROSPECT_CREATED: 'prospect_created',
  PROSPECT_UPDATED: 'prospect_updated',
  PROSPECT_DELETED: 'prospect_deleted',
  INVOICE_CREATED: 'invoice_created',
  INVOICE_UPDATED: 'invoice_updated',
  CLIENT_CREATED: 'client_created',
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  // Add more as needed
};