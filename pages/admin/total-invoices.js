// pages/admin/total-invoices.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconSearch,
  IconEdit,
  IconTrash,
  IconEye,
  IconFileText,
  IconBuilding,
  IconCalendar,
  IconCurrencyDollar,
  IconCheck,
  IconAlertTriangle,
  IconSortAscending,
  IconSortDescending,
  IconFilter,
  IconArrowLeft,
} from '@tabler/icons-react';

export default function TotalInvoices() {
  const router = useRouter();
  const [invoices, setInvoices] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/admin/login');
        return;
      }
      
      fetchRestaurants();
    };
    checkUser();
  }, [router]);

  useEffect(() => {
    fetchInvoices();
  }, [selectedRestaurant]);

  async function fetchRestaurants() {
    try {
      const { data, error } = await supabase
        .from('restaurants')
        .select('id, name')
        .order('name');

      if (error) throw error;
      setRestaurants(data || []);
    } catch (error) {
      console.error('Error fetching restaurants:', error);
    }
  }

  async function fetchInvoices() {
    try {
      setLoading(true);
      
      let query = supabase
        .from('invoices')
        .select(`
          *,
          restaurants!inner(name),
          invoice_items(count)
        `)
        .order('created_at', { ascending: false });

      if (selectedRestaurant) {
        query = query.eq('restaurant_id', selectedRestaurant);
      }

      const { data, error } = await query;

      if (error) throw error;
      setInvoices(data || []);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchInvoiceItems(invoiceId) {
    try {
      setItemsLoading(true);
      const { data, error } = await supabase
        .from('invoice_items')
        .select(`
          *,
          ingredients(name, unit, last_price)
        `)
        .eq('invoice_id', invoiceId)
        .order('item_name');

      if (error) throw error;
      setInvoiceItems(data || []);
    } catch (error) {
      console.error('Error fetching invoice items:', error);
      setInvoiceItems([]);
    } finally {
      setItemsLoading(false);
    }
  }

  async function handleDeleteInvoice(invoiceId) {
    if (!window.confirm('Are you sure you want to delete this invoice? This action cannot be undone.')) {
      return;
    }

    try {
      const { error: itemsError } = await supabase
        .from('invoice_items')
        .delete()
        .eq('invoice_id', invoiceId);

      if (itemsError) throw itemsError;

      const { error: invoiceError } = await supabase
        .from('invoices')
        .delete()
        .eq('id', invoiceId);

      if (invoiceError) throw invoiceError;

      setInvoices(prev => prev.filter(inv => inv.id !== invoiceId));
      
      if (selectedInvoice && selectedInvoice.id === invoiceId) {
        setSelectedInvoice(null);
        setInvoiceItems([]);
      }
      
      alert('Invoice deleted successfully');
    } catch (error) {
      console.error('Error deleting invoice:', error);
      alert('Failed to delete invoice: ' + error.message);
    }
  }

  function handleInvoiceClick(invoice) {
    setSelectedInvoice(invoice);
    fetchInvoiceItems(invoice.id);
  }

  function handleCloseDetails() {
    setSelectedInvoice(null);
    setInvoiceItems([]);
  }

  function handleEditInvoice(invoiceId) {
    router.push(`/admin/invoices/edit/${invoiceId}`);
  }

  function handleSort(field) {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }

  const filteredAndSortedInvoices = invoices
    .filter(invoice => {
      const searchLower = searchTerm.toLowerCase();
      return (
        (invoice.number || '').toLowerCase().includes(searchLower) ||
        (invoice.supplier || '').toLowerCase().includes(searchLower) ||
        (invoice.restaurants?.name || '').toLowerCase().includes(searchLower)
      );
    })
    .sort((a, b) => {
      let aValue = a[sortField];
      let bValue = b[sortField];
      
      if (sortField === 'amount') {
        aValue = parseFloat(aValue) || 0;
        bValue = parseFloat(bValue) || 0;
      } else if (sortField === 'date' || sortField === 'created_at') {
        aValue = new Date(aValue || 0);
        bValue = new Date(bValue || 0);
      } else {
        aValue = (aValue || '').toString().toLowerCase();
        bValue = (bValue || '').toString().toLowerCase();
      }
      
      if (sortDirection === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

  function getInvoiceStatus(invoice) {
    const hasAllFields = invoice.number && invoice.date && invoice.supplier && invoice.amount;
    const hasItems = invoice.invoice_items && invoice.invoice_items.length > 0;
    
    if (!hasAllFields) return { status: 'pending', label: 'Pending', color: 'bg-orange-100 text-orange-800' };
    if (!hasItems) return { status: 'incomplete', label: 'No Items', color: 'bg-red-100 text-red-800' };
    return { status: 'complete', label: 'Complete', color: 'bg-green-100 text-green-800' };
  }

  const selectedRestaurantName = selectedRestaurant 
    ? restaurants.find(r => r.id === selectedRestaurant)?.name || ''
    : 'All Restaurants';
  
  const allInvoicesCount = invoices.length;
  const completeInvoicesCount = invoices.filter(inv => getInvoiceStatus(inv).status === 'complete').length;
  const totalValue = invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);

  // Invoice Details View
  if (selectedInvoice) {
    return (
      <AdminLayout 
        pageTitle={`Invoice Details - ${selectedInvoice.number || 'Untitled'}`} 
        pageDescription={selectedInvoice.restaurants?.name}
        pageIcon={IconFileText}
      >
        {/* Back Button and Edit Action */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <button 
              onClick={handleCloseDetails}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <IconArrowLeft size={20} />
              <span>Back to Invoice List</span>
            </button>
            
            <button
              onClick={() => handleEditInvoice(selectedInvoice.id)}
              className="flex items-center gap-2 px-4 py-2 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
            >
              <IconEdit size={18} />
              Edit Invoice
            </button>
          </div>
        </div>

        <div className="p-6 max-w-6xl mx-auto space-y-6">
          {/* Invoice Summary */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Invoice Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-4">
                <div>
                  <span className="text-sm font-medium text-gray-500">Invoice Number</span>
                  <p className="text-lg text-gray-900">{selectedInvoice.number || 'Not set'}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-500">Supplier</span>
                  <p className="text-lg text-gray-900">{selectedInvoice.supplier || 'Not set'}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <span className="text-sm font-medium text-gray-500">Date</span>
                  <p className="text-lg text-gray-900">
                    {selectedInvoice.date 
                      ? new Date(selectedInvoice.date).toLocaleDateString()
                      : 'Not set'
                    }
                  </p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-500">Restaurant</span>
                  <p className="text-lg text-gray-900">{selectedInvoice.restaurants?.name || 'Unknown'}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <span className="text-sm font-medium text-gray-500">Total Amount</span>
                  <p className="text-2xl font-bold text-gray-900">
                    {selectedInvoice.amount 
                      ? `$${selectedInvoice.amount.toFixed(2)}`
                      : 'Not set'
                    }
                  </p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-500">Status</span>
                  <div className="mt-1">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getInvoiceStatus(selectedInvoice).color}`}>
                      {getInvoiceStatus(selectedInvoice).label}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Invoice Items */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Invoice Items</h2>
            {itemsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-8 h-8 border-2 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
                <span className="ml-3 text-gray-600">Loading items...</span>
              </div>
            ) : invoiceItems.length === 0 ? (
              <div className="text-center py-8">
                <IconFileText size={48} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No items found</h3>
                <p className="text-gray-600 mb-4">This invoice doesn't have any items yet.</p>
                <button
                  onClick={() => handleEditInvoice(selectedInvoice.id)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
                >
                  <IconEdit size={18} />
                  Add Items
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Desktop Table */}
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-900">Item Name</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-900">Quantity</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-900">Unit</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-900">Amount</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-900">Unit Cost</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-900">Linked Ingredient</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {invoiceItems.map((item, index) => (
                        <tr key={item.id || index} className="hover:bg-gray-50">
                          <td className="py-4 px-4 font-medium text-gray-900">{item.item_name}</td>
                          <td className="py-4 px-4 text-gray-900">{item.quantity}</td>
                          <td className="py-4 px-4 text-gray-900">{item.unit}</td>
                          <td className="py-4 px-4 text-gray-900">${item.amount?.toFixed(2) || '0.00'}</td>
                          <td className="py-4 px-4 text-gray-900">${item.unit_cost?.toFixed(4) || '0.0000'}</td>
                          <td className="py-4 px-4">
                            {item.ingredients?.name ? (
                              <div className="text-gray-900">
                                <div className="font-medium">{item.ingredients.name}</div>
                                <div className="text-xs text-gray-500">
                                  ${item.ingredients.last_price?.toFixed(4) || '0.0000'}/{item.ingredients.unit}
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-500 italic">Not linked</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards */}
                <div className="lg:hidden space-y-4">
                  {invoiceItems.map((item, index) => (
                    <div key={item.id || index} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                      <h3 className="font-medium text-gray-900 mb-3">{item.item_name}</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-gray-500">Quantity:</span>
                          <span className="ml-2 text-gray-900">{item.quantity} {item.unit}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Amount:</span>
                          <span className="ml-2 text-gray-900">${item.amount?.toFixed(2) || '0.00'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Unit Cost:</span>
                          <span className="ml-2 text-gray-900">${item.unit_cost?.toFixed(4) || '0.0000'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Ingredient:</span>
                          <span className="ml-2 text-gray-900">
                            {item.ingredients?.name || 'Not linked'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Items Summary */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Total Items:</span>
                      <span className="ml-2 font-medium text-gray-900">{invoiceItems.length}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Items Total:</span>
                      <span className="ml-2 font-medium text-gray-900">
                        ${invoiceItems.reduce((sum, item) => sum + (item.amount || 0), 0).toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Linked Ingredients:</span>
                      <span className="ml-2 font-medium text-gray-900">
                        {invoiceItems.filter(item => item.ingredients?.name).length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </AdminLayout>
    );
  }

  // Main Invoice List View
  return (
    <AdminLayout 
      pageTitle="All Invoices" 
      pageDescription="View and manage all invoices"
      pageIcon={IconFileText}
    >
      {/* Controls */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex items-center gap-3">
            <IconFilter size={20} className="text-gray-400" />
            <select 
              value={selectedRestaurant} 
              onChange={(e) => setSelectedRestaurant(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
            >
              <option value="">All Restaurants</option>
              {restaurants.map(restaurant => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 relative">
            <IconSearch size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by invoice number, supplier, or restaurant..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
            />
          </div>
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-10 h-10 border-3 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
            <span className="ml-3 text-gray-600">Loading invoices...</span>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg">
                    <IconFileText size={24} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{allInvoicesCount}</p>
                    <p className="text-gray-600">Total Invoices</p>
                    <p className="text-sm text-gray-500">{selectedRestaurantName}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg">
                    <IconCheck size={24} className="text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{completeInvoicesCount}</p>
                    <p className="text-gray-600">Complete</p>
                    <p className="text-sm text-gray-500">
                      {allInvoicesCount > 0 ? Math.round((completeInvoicesCount / allInvoicesCount) * 100) : 0}% processed
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
                    <p className="text-2xl font-bold text-gray-900">${totalValue.toFixed(2)}</p>
                    <p className="text-gray-600">Total Value</p>
                    <p className="text-sm text-gray-500">Combined invoice amount</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Invoices Table */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              {filteredAndSortedInvoices.length === 0 ? (
                <div className="text-center py-12">
                  <IconFileText size={48} className="mx-auto mb-4 text-gray-300" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Invoices Found</h3>
                  <p className="text-gray-600">
                    {searchTerm 
                      ? `No invoices match "${searchTerm}"`
                      : selectedRestaurant 
                        ? `${selectedRestaurantName} has no invoices yet.`
                        : 'No invoices have been uploaded yet.'
                    }
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th 
                          className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('number')}
                        >
                          <div className="flex items-center gap-2">
                            Invoice #
                            {sortField === 'number' && (
                              sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                            )}
                          </div>
                        </th>
                        <th 
                          className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('date')}
                        >
                          <div className="flex items-center gap-2">
                            Date
                            {sortField === 'date' && (
                              sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                            )}
                          </div>
                        </th>
                        <th 
                          className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('supplier')}
                        >
                          <div className="flex items-center gap-2">
                            Supplier
                            {sortField === 'supplier' && (
                              sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                            )}
                          </div>
                        </th>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Restaurant</th>
                        <th 
                          className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('amount')}
                        >
                          <div className="flex items-center gap-2">
                            Amount
                            {sortField === 'amount' && (
                              sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                            )}
                          </div>
                        </th>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Status</th>
                        <th 
                          className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('created_at')}
                        >
                          <div className="flex items-center gap-2">
                            Uploaded
                            {sortField === 'created_at' && (
                              sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                            )}
                          </div>
                        </th>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredAndSortedInvoices.map(invoice => {
                        const status = getInvoiceStatus(invoice);
                        
                        return (
                          <tr 
                            key={invoice.id} 
                            className="hover:bg-gray-50 cursor-pointer"
                            onClick={() => handleInvoiceClick(invoice)}
                          >
                            <td className="py-4 px-6">
                              <div className="font-medium text-gray-900">
                                {invoice.number || <span className="text-gray-400 italic">Not set</span>}
                              </div>
                            </td>
                            
                            <td className="py-4 px-6 text-gray-900">
                              {invoice.date 
                                ? new Date(invoice.date).toLocaleDateString()
                                : <span className="text-gray-400 italic">Not set</span>
                              }
                            </td>
                            
                            <td className="py-4 px-6 text-gray-900">
                              {invoice.supplier || <span className="text-gray-400 italic">Not set</span>}
                            </td>
                            
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-2">
                                <IconBuilding size={16} className="text-gray-400" />
                                <span className="text-gray-900">{invoice.restaurants?.name || 'Unknown'}</span>
                              </div>
                            </td>
                            
                            <td className="py-4 px-6">
                              <div className="font-medium text-gray-900">
                                {invoice.amount 
                                  ? `$${invoice.amount.toFixed(2)}`
                                  : <span className="text-gray-400 italic">Not set</span>
                                }
                              </div>
                            </td>
                            
                            <td className="py-4 px-6">
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${status.color}`}>
                                {status.label}
                              </span>
                            </td>
                            
                            <td className="py-4 px-6 text-gray-900">
                              <div className="flex items-center gap-2">
                                <IconCalendar size={16} className="text-gray-400" />
                                {new Date(invoice.created_at).toLocaleDateString()}
                              </div>
                            </td>
                            
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleInvoiceClick(invoice);
                                  }}
                                  className="flex items-center gap-1 px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors text-sm"
                                  title="View Details"
                                >
                                  <IconEye size={16} />
                                  View
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEditInvoice(invoice.id);
                                  }}
                                  className="flex items-center gap-1 px-3 py-1.5 text-[#ADD8E6] hover:text-[#9CC5D4] hover:bg-blue-50 rounded-md transition-colors text-sm"
                                  title="Edit Invoice"
                                >
                                  <IconEdit size={16} />
                                  Edit
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteInvoice(invoice.id);
                                  }}
                                  className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors text-sm"
                                  title="Delete Invoice"
                                >
                                  <IconTrash size={16} />
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}