// pages/admin/activity.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconBell,
  IconFileText,
  IconUsers,
  IconClock,
  IconCalendar,
  IconRefresh,
  IconFilter,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
} from '@tabler/icons-react';
import { ACTIVITY_TYPES } from '../../lib/activityLogger';

export default function ActivityPage() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const router = useRouter();
  
  const ITEMS_PER_PAGE = 20;

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/admin/login');
        return;
      }
      fetchActivities();
    };
    checkUser();
  }, [router, currentPage, filterType, searchTerm]);

  async function fetchActivities() {
    try {
      setLoading(true);
      
      let query = supabase
        .from('activity_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Apply filter
      if (filterType !== 'all') {
        query = query.eq('activity_type', filterType);
      }

      // Apply search
      if (searchTerm) {
        query = query.or(`title.ilike.%${searchTerm}%,subtitle.ilike.%${searchTerm}%,restaurant_name.ilike.%${searchTerm}%`);
      }

      // Apply pagination
      const from = (currentPage - 1) * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      setActivities(data || []);
      setTotalPages(Math.ceil((count || 0) / ITEMS_PER_PAGE));
    } catch (error) {
      console.error('Error fetching activities:', error);
    } finally {
      setLoading(false);
    }
  }

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

  const getActivityTypeLabel = (type) => {
    switch (type) {
      case ACTIVITY_TYPES.PROSPECT_CREATED:
        return 'Prospect Created';
      case ACTIVITY_TYPES.PROSPECT_UPDATED:
        return 'Prospect Updated';
      case ACTIVITY_TYPES.PROSPECT_DELETED:
        return 'Prospect Deleted';
      case ACTIVITY_TYPES.INVOICE_CREATED:
        return 'Invoice Created';
      case ACTIVITY_TYPES.INVOICE_UPDATED:
        return 'Invoice Updated';
      default:
        return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
  };

  const getActivityTypeColor = (type) => {
    switch (type) {
      case ACTIVITY_TYPES.PROSPECT_CREATED:
        return 'bg-green-100 text-green-800';
      case ACTIVITY_TYPES.PROSPECT_UPDATED:
        return 'bg-blue-100 text-blue-800';
      case ACTIVITY_TYPES.PROSPECT_DELETED:
        return 'bg-red-100 text-red-800';
      case ACTIVITY_TYPES.INVOICE_CREATED:
        return 'bg-purple-100 text-purple-800';
      case ACTIVITY_TYPES.INVOICE_UPDATED:
        return 'bg-indigo-100 text-indigo-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDateTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now - date) / (1000 * 60 * 60);
    
    if (diffInHours < 1) {
      const diffInMinutes = Math.floor((now - date) / (1000 * 60));
      return `${diffInMinutes} minute${diffInMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffInHours < 24) {
      const hours = Math.floor(diffInHours);
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    } else if (diffInHours < 48) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const uniqueActivityTypes = [
    ...new Set(Object.values(ACTIVITY_TYPES))
  ];

  if (loading && activities.length === 0) {
    return (
      <AdminLayout 
        pageTitle="Activity Log" 
        pageDescription="Complete system activity history"
        pageIcon={IconBell}
      >
        <div className="p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
            <p className="text-gray-600">Loading activities...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout 
      pageTitle="Activity Log" 
      pageDescription="Complete system activity history"
      pageIcon={IconBell}
    >
      {/* Header Controls */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              onClick={fetchActivities}
              disabled={loading}
            >
              <IconRefresh size={18} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Search and Filter Controls */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <IconSearch size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search activities..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
            />
          </div>
          
          {/* Filter */}
          <div className="sm:w-48">
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
            >
              <option value="all">All Activities</option>
              {uniqueActivityTypes.map(type => (
                <option key={type} value={type}>
                  {getActivityTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">System Activity</h3>
                <p className="text-gray-600">
                  {searchTerm || filterType !== 'all' 
                    ? `Filtered results • Page ${currentPage} of ${totalPages}`
                    : `All system activities • Page ${currentPage} of ${totalPages}`
                  }
                </p>
              </div>
            </div>
          </div>

          {activities.length === 0 ? (
            <div className="text-center py-12">
              <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6">
                <IconBell size={32} className="text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                {searchTerm || filterType !== 'all' ? 'No Activities Found' : 'No Activities Yet'}
              </h3>
              <p className="text-gray-600 mb-6">
                {searchTerm || filterType !== 'all'
                  ? `No activities match your current filters`
                  : 'System activities will appear here as actions are performed.'
                }
              </p>
              {(searchTerm || filterType !== 'all') && (
                <button 
                  className="inline-flex items-center gap-2 px-4 py-2 text-blue-600 hover:text-blue-700 transition-colors"
                  onClick={() => {
                    setSearchTerm('');
                    setFilterType('all');
                    setCurrentPage(1);
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Activities List */}
              <div className="divide-y divide-gray-100">
                {activities.map((activity) => {
                  const IconComponent = getActivityIcon(activity.activity_type);
                  
                  return (
                    <div key={activity.id} className="p-6 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start gap-4">
                        <div className="flex items-center justify-center w-12 h-12 bg-white border border-gray-200 rounded-lg text-gray-600 flex-shrink-0 shadow-sm">
                          <IconComponent size={20} />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-1">
                                <h4 className="font-medium text-gray-900 truncate">{activity.title}</h4>
                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getActivityTypeColor(activity.activity_type)}`}>
                                  {getActivityTypeLabel(activity.activity_type)}
                                </span>
                                {activity.restaurant_name && (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[#ADD8E6] text-gray-900">
                                    {activity.restaurant_name}
                                  </span>
                                )}
                              </div>
                              
                              {activity.subtitle && (
                                <p className="text-sm text-gray-700 mb-1">{activity.subtitle}</p>
                              )}
                              
                              {activity.details && (
                                <p className="text-xs text-gray-500">{activity.details}</p>
                              )}
                            </div>
                            
                            <div className="text-right text-xs text-gray-500 flex-shrink-0">
                              <div className="flex items-center gap-1 mb-1">
                                <IconClock size={12} />
                                {formatDateTime(activity.created_at)}
                              </div>
                              <div className="text-gray-400">
                                {new Date(activity.created_at).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </div>
                            </div>
                          </div>
                          
                          {/* Metadata (if needed) */}
                          {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                            <div className="mt-2 text-xs text-gray-400">
                              <details className="cursor-pointer">
                                <summary className="hover:text-gray-600">View details</summary>
                                <pre className="mt-1 p-2 bg-gray-50 rounded text-xs overflow-x-auto">
                                  {JSON.stringify(activity.metadata, null, 2)}
                                </pre>
                              </details>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-600">
                      Page {currentPage} of {totalPages} • {activities.length} activities shown
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <IconChevronLeft size={16} />
                        Previous
                      </button>
                      
                      {/* Page Numbers */}
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          let pageNum;
                          if (totalPages <= 5) {
                            pageNum = i + 1;
                          } else if (currentPage <= 3) {
                            pageNum = i + 1;
                          } else if (currentPage >= totalPages - 2) {
                            pageNum = totalPages - 4 + i;
                          } else {
                            pageNum = currentPage - 2 + i;
                          }
                          
                          return (
                            <button
                              key={pageNum}
                              onClick={() => handlePageChange(pageNum)}
                              className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                                pageNum === currentPage
                                  ? 'bg-[#ADD8E6] text-gray-900 font-medium'
                                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                              }`}
                            >
                              {pageNum}
                            </button>
                          );
                        })}
                      </div>
                      
                      <button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                        <IconChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}