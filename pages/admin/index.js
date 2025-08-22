// pages/admin/index.js (Updated Dashboard with Dynamic System Health)
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconDashboard,
  IconClock,
  IconFileText,
  IconTrendingUp,
  IconUsers,
  IconBell,
  IconSettings,
  IconCheck,
  IconActivity,
  IconWifi,
} from '@tabler/icons-react';
import { ACTIVITY_TYPES } from '../../lib/activityLogger';

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    clientCount: 0,
    pendingInvoices: 0,
    totalInvoices: 0,
    totalRevenue: 0,
    loading: true
  });
  const [systemHealth, setSystemHealth] = useState({
    recentActivity: { count: 0, status: 'excellent', loading: true },
    clientEngagement: { percentage: 0, status: 'excellent', loading: true },
    systemResponse: { status: 'operational', loading: true }
  });
  const router = useRouter();

  // Updated to fetch only 3 recent activities
  async function fetchRecentActivity() {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(3); // Changed from 4 to 3

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching recent activity:', error);
      return [];
    }
  }

  // Fetch system health metrics
  async function fetchSystemHealth() {
    try {
      const healthPromises = [
        fetchRecentActivityHealth(),
        fetchClientEngagementHealth(),
        fetchSystemResponseHealth()
      ];

      const [recentActivity, clientEngagement, systemResponse] = await Promise.all(healthPromises);

      setSystemHealth({
        recentActivity,
        clientEngagement,
        systemResponse
      });
    } catch (error) {
      console.error('Error fetching system health:', error);
      setSystemHealth({
        recentActivity: { count: 0, status: 'error', loading: false },
        clientEngagement: { percentage: 0, status: 'error', loading: false },
        systemResponse: { status: 'error', loading: false }
      });
    }
  }

  // Recent Activity Health (last 24 hours)
  async function fetchRecentActivityHealth() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const { data, error } = await supabase
        .from('activity_logs')
        .select('id')
        .gte('created_at', yesterday.toISOString());

      if (error) throw error;

      const count = data?.length || 0;
      let status = 'poor';
      if (count > 5) status = 'excellent';
      else if (count >= 2) status = 'good';

      return { count, status, loading: false };
    } catch (error) {
      console.error('Error fetching recent activity health:', error);
      return { count: 0, status: 'error', loading: false };
    }
  }

  // Client Engagement Health (invoices uploaded in last 30 days)
  async function fetchClientEngagementHealth() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Get total restaurants
      const { data: allRestaurants, error: restaurantError } = await supabase
        .from('restaurants')
        .select('id');

      if (restaurantError) throw restaurantError;

      // Get restaurants that uploaded invoices in last 30 days
      const { data: activeRestaurants, error: activeError } = await supabase
        .from('invoices')
        .select('restaurant_id')
        .gte('created_at', thirtyDaysAgo.toISOString());

      if (activeError) throw activeError;

      const totalRestaurants = allRestaurants?.length || 0;
      const uniqueActiveRestaurants = new Set(activeRestaurants?.map(inv => inv.restaurant_id)).size;
      
      const percentage = totalRestaurants > 0 ? Math.round((uniqueActiveRestaurants / totalRestaurants) * 100) : 0;
      
      let status = 'poor';
      if (percentage > 70) status = 'excellent';
      else if (percentage >= 40) status = 'good';

      return { percentage, status, loading: false };
    } catch (error) {
      console.error('Error fetching client engagement health:', error);
      return { percentage: 0, status: 'error', loading: false };
    }
  }

  // System Response Health (check if we can fetch data successfully)
  async function fetchSystemResponseHealth() {
    try {
      const startTime = Date.now();
      
      // Simple query to test database responsiveness
      const { data, error } = await supabase
        .from('activity_logs')
        .select('id')
        .limit(1);

      const responseTime = Date.now() - startTime;

      if (error) throw error;

      let status = 'operational';
      if (responseTime > 3000) status = 'slow';
      else if (responseTime > 1000) status = 'minor-issues';

      return { status, responseTime, loading: false };
    } catch (error) {
      console.error('Error testing system response:', error);
      return { status: 'error', loading: false };
    }
  }

  useEffect(() => {
    fetchDashboardStats();
    fetchSystemHealth();
  }, []);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/admin/login');
      }
    };
    checkUser();
  }, [router]);

  async function fetchDashboardStats() {
    try {
      // Get client count (restaurants)
      const { data: restaurants, error: restaurantError } = await supabase
        .from('restaurants')
        .select('id');

      if (restaurantError) throw restaurantError;

      // Get all invoices
      const { data: allInvoices, error: invoicesError } = await supabase
        .from('invoices')
        .select('id, number, date, supplier, amount');

      if (invoicesError) throw invoicesError;

      // Filter for pending invoices
      const pendingInvoices = allInvoices.filter(invoice => {
        return !invoice.number || !invoice.date || !invoice.supplier || !invoice.amount;
      });

      // Calculate total revenue
      const totalRevenue = allInvoices.reduce((sum, invoice) => sum + (invoice.amount || 0), 0);

      // Fetch recent activity
      const recentActivity = await fetchRecentActivity();

      setStats({
        clientCount: restaurants?.length || 0,
        pendingInvoices: pendingInvoices?.length || 0,
        totalInvoices: allInvoices?.length || 0,
        totalRevenue,
        recentActivity,
        loading: false
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      setStats(prev => ({ ...prev, loading: false }));
    }
  }

  const getHealthStatusStyle = (status) => {
    switch (status) {
      case 'excellent':
        return 'bg-green-100 text-green-800';
      case 'good':
        return 'bg-yellow-100 text-yellow-800';
      case 'poor':
        return 'bg-red-100 text-red-800';
      case 'operational':
        return 'bg-green-100 text-green-800';
      case 'minor-issues':
        return 'bg-yellow-100 text-yellow-800';
      case 'slow':
        return 'bg-orange-100 text-orange-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getHealthStatusText = (metric, status) => {
    switch (metric) {
      case 'recentActivity':
        switch (status) {
          case 'excellent': return 'Very Active';
          case 'good': return 'Active';
          case 'poor': return 'Quiet';
          case 'error': return 'Error';
          default: return 'Unknown';
        }
      case 'clientEngagement':
        switch (status) {
          case 'excellent': return 'High';
          case 'good': return 'Moderate';
          case 'poor': return 'Low';
          case 'error': return 'Error';
          default: return 'Unknown';
        }
      case 'systemResponse':
        switch (status) {
          case 'operational': return 'Operational';
          case 'minor-issues': return 'Minor Issues';
          case 'slow': return 'Slow';
          case 'error': return 'Error';
          default: return 'Unknown';
        }
      default:
        return 'Unknown';
    }
  };

  if (stats.loading) {
    return (
      <AdminLayout 
        pageTitle="System Overview" 
        pageDescription="Monitor your OptiMenu operations"
        pageIcon={IconDashboard}
      >
        <div className="p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
            <p className="text-gray-600">Loading dashboard...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout 
      pageTitle="System Overview" 
      pageDescription="Monitor your OptiMenu operations"
      pageIcon={IconDashboard}
    >
      <div className="h-screen flex flex-col overflow-hidden">
        {/* Overview Stats Grid */}
        <section className="flex-shrink-0 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div 
              className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 cursor-pointer"
              onClick={() => router.push('/admin/total-invoices')}
            >
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-lg text-gray-600">
                  <IconFileText size={24} />
                </div>
                <div className="flex-1">
                  <div className="text-2xl font-bold text-gray-900">{stats.totalInvoices}</div>
                  <div className="text-sm font-medium text-gray-900 mb-1">Total Invoices</div>
                  <div className="text-xs text-gray-600">All processed invoices</div>
                </div>
                <div className="bg-[#ADD8E6] text-gray-900 text-xs font-semibold px-2 py-1 rounded">
                  +12%
                </div>
              </div>
            </div>

            <div 
              className={`bg-white border rounded-xl p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 cursor-pointer ${
                stats.pendingInvoices > 0 ? 'border-red-300 bg-red-50' : 'border-gray-200'
              }`}
              onClick={() => router.push('/admin/pending-invoices')}
            >
              <div className="flex items-center gap-4">
                <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${
                  stats.pendingInvoices > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'
                }`}>
                  <IconClock size={24} />
                </div>
                <div className="flex-1">
                  <div className="text-2xl font-bold text-gray-900">{stats.pendingInvoices}</div>
                  <div className="text-sm font-medium text-gray-900 mb-1">Pending Review</div>
                  <div className="text-xs text-gray-600">
                    {stats.pendingInvoices > 0 ? 'Requires attention' : 'All caught up!'}
                  </div>
                </div>
                {stats.pendingInvoices > 0 && (
                  <div className="bg-red-500 text-white text-xs font-semibold px-2 py-1 rounded">
                    Action needed
                  </div>
                )}
              </div>
            </div>

            <div 
              className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 cursor-pointer"
              onClick={() => router.push('/admin/clients')}
            >
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-lg text-gray-600">
                  <IconUsers size={24} />
                </div>
                <div className="flex-1">
                  <div className="text-2xl font-bold text-gray-900">{stats.clientCount}</div>
                  <div className="text-sm font-medium text-gray-900 mb-1">Active Clients</div>
                  <div className="text-xs text-gray-600">Restaurant partners</div>
                </div>
                <div className="bg-[#ADD8E6] text-gray-900 text-xs font-semibold px-2 py-1 rounded">
                  +3
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-lg text-gray-600">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="1" x2="12" y2="23"/>
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-2xl font-bold text-gray-900">${stats.totalRevenue.toLocaleString()}</div>
                  <div className="text-sm font-medium text-gray-900 mb-1">Total Revenue</div>
                  <div className="text-xs text-gray-600">Invoice value processed</div>
                </div>
                <div className="bg-[#ADD8E6] text-gray-900 text-xs font-semibold px-2 py-1 rounded">
                  +8%
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Recent Activity - Fills remaining space */}
        <section className="flex-1 px-6 flex flex-col min-h-0 overflow-hidden">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col h-full">
            <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-xl font-semibold text-gray-900">Recent Activity</h2>
              <button 
                className="text-gray-600 hover:text-gray-900 text-sm transition-colors"
                onClick={() => router.push('/admin/activity')}
              >
                View all activity →
              </button>
            </div>
            <div className="flex-1 p-6 pt-2 overflow-y-auto">
              <div className="space-y-4 h-full">
                {stats.recentActivity?.length > 0 ? (
                  stats.recentActivity.map((activity, index) => {
                    // Map activity types to icons
                    const getActivityIcon = (type) => {
                      switch (type) {
                        case ACTIVITY_TYPES.PROSPECT_CREATED:
                        case ACTIVITY_TYPES.PROSPECT_UPDATED:
                        case ACTIVITY_TYPES.PROSPECT_DELETED:
                          return IconUsers;
                        case ACTIVITY_TYPES.INVOICE_CREATED:
                        case ACTIVITY_TYPES.INVOICE_UPDATED:
                          return IconFileText;
                        default:
                          return IconFileText;
                      }
                    };

                    const IconComponent = getActivityIcon(activity.activity_type);
                    
                    return (
                      <div key={activity.id} className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                        <div className="flex items-center justify-center w-10 h-10 bg-white rounded-lg text-gray-600 flex-shrink-0 mt-1 shadow-sm">
                          <IconComponent size={16} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
                            <div className="font-medium text-gray-900">{activity.title}</div>
                            {activity.restaurant_name && (
                              <div className="bg-[#ADD8E6] text-gray-900 text-xs font-semibold px-2 py-1 rounded-full">
                                {activity.restaurant_name}
                              </div>
                            )}
                          </div>
                          {activity.subtitle && (
                            <div className="text-sm text-gray-700 mb-1">{activity.subtitle}</div>
                          )}
                          {activity.details && (
                            <div className="text-xs text-gray-500">{activity.details}</div>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 flex-shrink-0 mt-1">
                          {new Date(activity.created_at).toLocaleDateString() === new Date().toLocaleDateString() 
                            ? 'Today' 
                            : new Date(activity.created_at).toLocaleDateString()
                          }
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-8 h-full flex flex-col justify-center">
                    <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-lg mx-auto mb-4">
                      <IconBell size={24} className="text-gray-400" />
                    </div>
                    <p className="text-gray-500">No recent activity to display</p>
                    <p className="text-sm text-gray-400 mt-1">Activity logs will appear here as actions are performed</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* System Health - Fixed at bottom */}
        <section className="flex-shrink-0 p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Recent Activity Health */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <IconActivity size={16} className="text-gray-600" />
                  <span className="text-sm font-medium text-gray-900">Recent Activity</span>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded ${getHealthStatusStyle(systemHealth.recentActivity.status)}`}>
                  {systemHealth.recentActivity.loading ? 'Loading...' : getHealthStatusText('recentActivity', systemHealth.recentActivity.status)}
                </span>
              </div>
              <div className="text-xs text-gray-600">
                {systemHealth.recentActivity.loading 
                  ? 'Checking activity levels...'
                  : `${systemHealth.recentActivity.count} activities in last 24 hours`
                }
              </div>
            </div>
            
            {/* Client Engagement Health */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <IconUsers size={16} className="text-gray-600" />
                  <span className="text-sm font-medium text-gray-900">Client Engagement</span>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded ${getHealthStatusStyle(systemHealth.clientEngagement.status)}`}>
                  {systemHealth.clientEngagement.loading ? 'Loading...' : getHealthStatusText('clientEngagement', systemHealth.clientEngagement.status)}
                </span>
              </div>
              <div className="text-xs text-gray-600">
                {systemHealth.clientEngagement.loading 
                  ? 'Analyzing client activity...'
                  : `${systemHealth.clientEngagement.percentage}% active this month`
                }
              </div>
            </div>
            
            {/* System Response Health */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <IconWifi size={16} className="text-gray-600" />
                  <span className="text-sm font-medium text-gray-900">System Response</span>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded ${getHealthStatusStyle(systemHealth.systemResponse.status)}`}>
                  {systemHealth.systemResponse.loading ? 'Testing...' : getHealthStatusText('systemResponse', systemHealth.systemResponse.status)}
                </span>
              </div>
              <div className="text-xs text-gray-600">
                {systemHealth.systemResponse.loading 
                  ? 'Testing system response...'
                  : systemHealth.systemResponse.status === 'operational' 
                    ? 'All systems running smoothly'
                    : systemHealth.systemResponse.status === 'error'
                    ? 'Connection issues detected'
                    : `Response time: ${systemHealth.systemResponse.responseTime}ms`
                }
              </div>
            </div>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}