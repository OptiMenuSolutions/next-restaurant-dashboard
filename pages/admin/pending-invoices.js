// pages/admin/pending-invoices.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconFileText,
  IconClock,
  IconEye,
  IconCalendar,
  IconBuilding,
  IconAlertTriangle,
  IconCheck,
  IconFile,
  IconFileImage,
  IconRefresh,
} from '@tabler/icons-react';

export default function PendingInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restaurants, setRestaurants] = useState({});
  const router = useRouter();

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/admin/login');
        return;
      }
      
      fetchPendingInvoices();
    };
    checkUser();
  }, [router]);

  async function fetchPendingInvoices() {
    try {
      setRefreshing(true);
      
      // Get pending invoices (where required fields are null)
      const { data: pendingInvoices, error: invoicesError } = await supabase
        .from('invoices')
        .select('*')
        .or('number.is.null,date.is.null,supplier.is.null,amount.is.null')
        .order('created_at', { ascending: false });

      if (invoicesError) throw invoicesError;

      // Get restaurant names
      const restaurantIds = [...new Set(pendingInvoices?.map(inv => inv.restaurant_id).filter(Boolean))];
      
      if (restaurantIds.length > 0) {
        const { data: restaurantData, error: restaurantError } = await supabase
          .from('restaurants')
          .select('id, name')
          .in('id', restaurantIds);

        if (restaurantError) throw restaurantError;

        const restaurantMap = {};
        restaurantData.forEach(restaurant => {
          restaurantMap[restaurant.id] = restaurant.name;
        });
        setRestaurants(restaurantMap);
      }

      setInvoices(pendingInvoices || []);
    } catch (error) {
      console.error('Error fetching pending invoices:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function getFileType(url) {
    if (!url) return 'Unknown';
    const extension = url.split('.').pop().toLowerCase();
    if (extension === 'pdf') return 'PDF';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'Image';
    return 'File';
  }

  function getFileIcon(url) {
    const fileType = getFileType(url);
    if (fileType === 'PDF') return IconFile;
    if (fileType === 'Image') return IconFileImage;
    return IconFileText;
  }

  function getMissingFields(invoice) {
    const missing = [];
    if (!invoice.number) missing.push('Number');
    if (!invoice.date) missing.push('Date');
    if (!invoice.supplier) missing.push('Supplier');
    if (!invoice.amount) missing.push('Amount');
    return missing;
  }

  if (loading) {
    return (
      <AdminLayout 
        pageTitle="Pending Invoices" 
        pageDescription="Review and process uploaded invoices"
        pageIcon={IconClock}
      >
        <div className="p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
            <p className="text-gray-600">Loading pending invoices...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout 
      pageTitle="Pending Invoices" 
      pageDescription="Review and process uploaded invoices"
      pageIcon={IconClock}
    >
      {/* Action Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 px-3 py-2 bg-orange-100 text-orange-800 rounded-lg">
            <IconAlertTriangle size={16} />
            <span className="font-medium">{invoices.length} pending</span>
          </div>
          <button 
            onClick={fetchPendingInvoices}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <IconRefresh size={18} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        {invoices.length === 0 ? (
          // Empty State
          <div className="max-w-md mx-auto text-center py-12">
            <div className="flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mx-auto mb-6">
              <IconCheck size={32} className="text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">All caught up!</h2>
            <p className="text-gray-600 mb-6">
              There are no pending invoices to review at this time. 
              All uploaded invoices have been processed.
            </p>
            <button 
              onClick={() => router.push('/admin')}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
            >
              Back to Dashboard
            </button>
          </div>
        ) : (
          // Invoice Table
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Restaurant</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Upload Date</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">File Type</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Status</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Missing Fields</th>
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invoices.map((invoice) => {
                    const missingFields = getMissingFields(invoice);
                    const FileIcon = getFileIcon(invoice.file_url);
                    
                    return (
                      <tr 
                        key={invoice.id} 
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => router.push(`/admin/invoices/edit/${invoice.id}`)}
                      >
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center w-10 h-10 bg-[#ADD8E6] rounded-lg">
                              <IconBuilding size={18} className="text-gray-900" />
                            </div>
                            <div>
                              <div className="font-medium text-gray-900">
                                {restaurants[invoice.restaurant_id] || 'Unknown Restaurant'}
                              </div>
                              <div className="text-sm text-gray-500">
                                ID: {invoice.restaurant_id}
                              </div>
                            </div>
                          </div>
                        </td>
                        
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2 text-gray-900">
                            <IconCalendar size={16} className="text-gray-400" />
                            <div>
                              <div className="font-medium">
                                {new Date(invoice.created_at).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                })}
                              </div>
                              <div className="text-sm text-gray-500">
                                {new Date(invoice.created_at).toLocaleTimeString('en-US', {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </div>
                            </div>
                          </div>
                        </td>
                        
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            <FileIcon size={16} className="text-gray-400" />
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {getFileType(invoice.file_url)}
                            </span>
                          </div>
                        </td>
                        
                        <td className="py-4 px-6">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                            <IconAlertTriangle size={12} />
                            Pending Review
                          </span>
                        </td>
                        
                        <td className="py-4 px-6">
                          <div className="flex flex-wrap gap-1">
                            {missingFields.map((field) => (
                              <span 
                                key={field} 
                                className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-red-100 text-red-800"
                              >
                                {field}
                              </span>
                            ))}
                          </div>
                        </td>
                        
                        <td className="py-4 px-6">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/admin/invoices/edit/${invoice.id}`);
                            }}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
                          >
                            <IconEye size={16} />
                            Review
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="lg:hidden">
              {invoices.map((invoice) => {
                const missingFields = getMissingFields(invoice);
                const FileIcon = getFileIcon(invoice.file_url);
                
                return (
                  <div 
                    key={invoice.id}
                    className="p-6 border-b border-gray-200 last:border-b-0 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/admin/invoices/edit/${invoice.id}`)}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-12 h-12 bg-[#ADD8E6] rounded-lg">
                          <IconBuilding size={20} className="text-gray-900" />
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">
                            {restaurants[invoice.restaurant_id] || 'Unknown Restaurant'}
                          </div>
                          <div className="text-sm text-gray-500">
                            ID: {invoice.restaurant_id}
                          </div>
                        </div>
                      </div>
                      
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                        <IconAlertTriangle size={12} />
                        Pending
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <div className="text-sm text-gray-500 mb-1">Upload Date</div>
                        <div className="flex items-center gap-2 text-sm text-gray-900">
                          <IconCalendar size={14} className="text-gray-400" />
                          {new Date(invoice.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </div>
                      
                      <div>
                        <div className="text-sm text-gray-500 mb-1">File Type</div>
                        <div className="flex items-center gap-2">
                          <FileIcon size={14} className="text-gray-400" />
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {getFileType(invoice.file_url)}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mb-4">
                      <div className="text-sm text-gray-500 mb-2">Missing Fields</div>
                      <div className="flex flex-wrap gap-1">
                        {missingFields.map((field) => (
                          <span 
                            key={field} 
                            className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-red-100 text-red-800"
                          >
                            {field}
                          </span>
                        ))}
                      </div>
                    </div>
                    
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/admin/invoices/edit/${invoice.id}`);
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
                    >
                      <IconEye size={16} />
                      Review Invoice
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}