// pages/admin/clients.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconSearch,
  IconUsers,
  IconCurrencyDollar,
  IconCalendar,
  IconBuilding,
  IconChartBar,
  IconMenuDeep,
  IconSortAscending,
  IconSortDescending,
  IconMail,
  IconFileText,
  IconChefHat,
  IconActivity,
  IconRefresh,
  IconPlus,
  IconEye,
  IconUserPlus,
} from '@tabler/icons-react';

export default function ClientManagement() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/admin/login');
        return;
      }
      
      fetchClients();
    };
    checkUser();
  }, [router]);

  async function fetchClients() {
    try {
      setLoading(true);
      
      // Get restaurants with additional stats
      const { data: restaurants, error: restaurantError } = await supabase
        .from('restaurants')
        .select('*')
        .order('name');

      if (restaurantError) throw restaurantError;

      // For each restaurant, get additional statistics
      const clientsWithStats = await Promise.all(
        (restaurants || []).map(async (restaurant) => {
          try {
            // Get invoice count
            const { data: invoices, error: invoiceError } = await supabase
              .from('invoices')
              .select('id, amount, created_at')
              .eq('restaurant_id', restaurant.id);

            if (invoiceError) throw invoiceError;

            // Get menu items count
            const { data: menuItems, error: menuError } = await supabase
              .from('menu_items')
              .select('id')
              .eq('restaurant_id', restaurant.id);

            if (menuError) throw menuError;

            // Get ingredients count
            const { data: ingredients, error: ingredientError } = await supabase
              .from('ingredients')
              .select('id')
              .eq('restaurant_id', restaurant.id);

            if (ingredientError) throw ingredientError;

            // Calculate stats
            const totalInvoices = invoices?.length || 0;
            const totalSpent = invoices?.reduce((sum, inv) => sum + (inv.amount || 0), 0) || 0;
            const lastInvoiceDate = invoices?.length > 0 
              ? Math.max(...invoices.map(inv => new Date(inv.created_at).getTime()))
              : null;

            return {
              ...restaurant,
              stats: {
                totalInvoices,
                totalSpent,
                menuItemsCount: menuItems?.length || 0,
                ingredientsCount: ingredients?.length || 0,
                lastInvoiceDate: lastInvoiceDate ? new Date(lastInvoiceDate) : null
              }
            };
          } catch (error) {
            console.error(`Error fetching stats for ${restaurant.name}:`, error);
            return {
              ...restaurant,
              stats: {
                totalInvoices: 0,
                totalSpent: 0,
                menuItemsCount: 0,
                ingredientsCount: 0,
                lastInvoiceDate: null
              }
            };
          }
        })
      );

      setClients(clientsWithStats);
    } catch (error) {
      console.error('Error fetching clients:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleSort(field) {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }

  const filteredAndSortedClients = clients
    .filter(client => 
      client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (client.email || '').toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      let aValue, bValue;
      
      if (sortField.startsWith('stats.')) {
        const statField = sortField.split('.')[1];
        aValue = a.stats[statField];
        bValue = b.stats[statField];
        
        if (statField === 'lastInvoiceDate') {
          aValue = aValue ? aValue.getTime() : 0;
          bValue = bValue ? bValue.getTime() : 0;
        }
      } else {
        aValue = a[sortField];
        bValue = b[sortField];
      }
      
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      
      if (sortField === 'created_at' || sortField === 'stats.lastInvoiceDate') {
        aValue = new Date(aValue || 0);
        bValue = new Date(bValue || 0);
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      
      aValue = (aValue || '').toString().toLowerCase();
      bValue = (bValue || '').toString().toLowerCase();
      
      if (sortDirection === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

  const totalClients = clients.length;
  const activeClients = clients.filter(client => 
    client.stats.lastInvoiceDate && 
    client.stats.lastInvoiceDate > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  ).length;
  const totalRevenue = clients.reduce((sum, client) => sum + client.stats.totalSpent, 0);

  if (loading) {
    return (
      <AdminLayout 
        pageTitle="Client Management" 
        pageDescription="Manage restaurant partners and their data"
        pageIcon={IconUsers}
      >
        <div className="p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
            <div className="text-gray-600">Loading clients...</div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout 
      pageTitle="Client Management" 
      pageDescription="Manage restaurant partners and their data"
      pageIcon={IconUsers}
    >
      {/* Action Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              onClick={fetchClients}
            >
              <IconRefresh size={18} />
              Refresh
            </button>
            <button 
              className="flex items-center gap-2 px-3 py-2 text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors"
              onClick={() => router.push('/admin/prospective-clients')}
            >
              <IconUserPlus size={18} />
              View Prospects
            </button>
          </div>
          <button 
            className="flex items-center gap-2 px-4 py-2 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
            onClick={() => router.push('/admin/add-client')}
          >
            <IconPlus size={18} />
            Add Client
          </button>
        </div>
      </div>

      {/* Search Controls */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <IconSearch size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search clients by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg">
                <IconBuilding size={24} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{totalClients}</p>
                <p className="text-gray-600">Total Clients</p>
                <p className="text-sm text-gray-500">Restaurant partners</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg">
                <IconActivity size={24} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{activeClients}</p>
                <p className="text-gray-600">Active (30 days)</p>
                <p className="text-sm text-gray-500">
                  {totalClients > 0 ? Math.round((activeClients / totalClients) * 100) : 0}% of clients
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-emerald-100 rounded-lg">
                <IconCurrencyDollar size={24} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">${totalRevenue.toFixed(2)}</p>
                <p className="text-gray-600">Total Revenue</p>
                <p className="text-sm text-gray-500">Combined invoice value</p>
              </div>
            </div>
          </div>
        </div>

        {/* Clients Table */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">🏪 Restaurant Partners</h3>
                <p className="text-gray-600">{filteredAndSortedClients.length} clients</p>
              </div>
            </div>
          </div>

          {filteredAndSortedClients.length === 0 ? (
            <div className="text-center py-12">
              <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6">
                <IconBuilding size={32} className="text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                {searchTerm ? 'No Clients Found' : 'No Restaurant Partners Yet'}
              </h3>
              <p className="text-gray-600 mb-6">
                {searchTerm 
                  ? `No clients match "${searchTerm}"`
                  : 'No restaurant partners have been added yet.'
                }
              </p>
              {!searchTerm && (
                <button 
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
                  onClick={() => router.push('/admin/add-client')}
                >
                  <IconPlus size={18} />
                  Add Your First Client
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              {/* Desktop Table */}
              <div className="hidden lg:block">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th 
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('name')}
                      >
                        <div className="flex items-center gap-2">
                          Restaurant Name
                          {sortField === 'name' && (
                            sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th 
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('email')}
                      >
                        <div className="flex items-center gap-2">
                          Contact Email
                          {sortField === 'email' && (
                            sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th 
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('stats.totalInvoices')}
                      >
                        <div className="flex items-center gap-2">
                          Invoices
                          {sortField === 'stats.totalInvoices' && (
                            sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th 
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('stats.totalSpent')}
                      >
                        <div className="flex items-center gap-2">
                          Total Spent
                          {sortField === 'stats.totalSpent' && (
                            sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th 
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('stats.menuItemsCount')}
                      >
                        <div className="flex items-center gap-2">
                          Menu Items
                          {sortField === 'stats.menuItemsCount' && (
                            sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th 
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('stats.lastInvoiceDate')}
                      >
                        <div className="flex items-center gap-2">
                          Last Activity
                          {sortField === 'stats.lastInvoiceDate' && (
                            sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredAndSortedClients.map(client => {
                      const isActive = client.stats.lastInvoiceDate && 
                        client.stats.lastInvoiceDate > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                      
                      return (
                        <tr key={client.id} className="hover:bg-gray-50">
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center justify-center w-10 h-10 bg-[#ADD8E6] rounded-lg">
                                <IconBuilding size={18} className="text-gray-900" />
                              </div>
                              <div>
                                <div className="font-medium text-gray-900">{client.name}</div>
                                {isActive && (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                    Active
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <IconMail size={16} className="text-gray-400" />
                              <span className="text-gray-900">
                                {client.email || <span className="text-gray-400 italic">No email</span>}
                              </span>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <IconFileText size={16} className="text-gray-400" />
                              <span className="font-medium text-gray-900">{client.stats.totalInvoices}</span>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <IconCurrencyDollar size={16} className="text-gray-400" />
                              <span className="font-medium text-gray-900">${client.stats.totalSpent.toFixed(2)}</span>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <IconChefHat size={16} className="text-gray-400" />
                              <span className="text-gray-900">{client.stats.menuItemsCount}</span>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <IconCalendar size={16} className="text-gray-400" />
                              <span className="text-gray-900">
                                {client.stats.lastInvoiceDate 
                                  ? client.stats.lastInvoiceDate.toLocaleDateString()
                                  : <span className="text-gray-400 italic">Never</span>
                                }
                              </span>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <button
                                className="flex items-center gap-1 px-3 py-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors text-sm"
                                onClick={() => router.push(`/admin/analytics?restaurant=${client.id}`)}
                                title="View Analytics"
                              >
                                <IconChartBar size={16} />
                                Analytics
                              </button>
                              <button
                                className="flex items-center gap-1 px-3 py-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-md transition-colors text-sm"
                                onClick={() => router.push(`/admin/menu-items?restaurant=${client.id}`)}
                                title="Manage Menu"
                              >
                                <IconMenuDeep size={16} />
                                Menu
                              </button>
                              <button
                                className="flex items-center gap-1 px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors text-sm"
                                onClick={() => router.push(`/admin/client/${client.id}`)}
                                title="View Details"
                              >
                                <IconEye size={16} />
                                View
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="lg:hidden">
                {filteredAndSortedClients.map(client => {
                  const isActive = client.stats.lastInvoiceDate && 
                    client.stats.lastInvoiceDate > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                  
                  return (
                    <div key={client.id} className="p-6 border-b border-gray-200 last:border-b-0">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-12 h-12 bg-[#ADD8E6] rounded-lg">
                            <IconBuilding size={20} className="text-gray-900" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">{client.name}</h3>
                            <div className="text-sm text-gray-500 flex items-center gap-1">
                              <IconMail size={14} />
                              {client.email || 'No email'}
                            </div>
                          </div>
                        </div>
                        
                        {isActive && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Active
                          </span>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <div className="text-sm text-gray-500 mb-1">Invoices</div>
                          <div className="text-sm font-medium text-gray-900">{client.stats.totalInvoices}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500 mb-1">Total Spent</div>
                          <div className="text-sm font-medium text-gray-900">${client.stats.totalSpent.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500 mb-1">Menu Items</div>
                          <div className="text-sm font-medium text-gray-900">{client.stats.menuItemsCount}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500 mb-1">Last Activity</div>
                          <div className="text-sm font-medium text-gray-900">
                            {client.stats.lastInvoiceDate 
                              ? client.stats.lastInvoiceDate.toLocaleDateString()
                              : 'Never'
                            }
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        <button
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors text-sm"
                          onClick={() => router.push(`/admin/analytics?restaurant=${client.id}`)}
                        >
                          <IconChartBar size={16} />
                          Analytics
                        </button>
                        <button
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors text-sm"
                          onClick={() => router.push(`/admin/menu-items?restaurant=${client.id}`)}
                        >
                          <IconMenuDeep size={16} />
                          Menu
                        </button>
                        <button
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors text-sm"
                          onClick={() => router.push(`/admin/client/${client.id}`)}
                        >
                          <IconEye size={16} />
                          View
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}