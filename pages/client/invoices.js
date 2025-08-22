// pages/client/invoices.js - Updated to use InvoiceSearch component
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import ClientLayout from '../../components/ClientLayout';
import InvoiceSearch from '../../components/InvoiceSearch';
import supabase from '../../lib/supabaseClient';
import {
  IconFileText,
  IconUpload,
  IconEye,
  IconCalendar,
  IconCurrencyDollar,
  IconCheck,
  IconClock,
  IconAlertTriangle,
  IconX,
  IconSortAscending,
  IconSortDescending,
  IconSearch,
  IconExternalLink,
  IconClipboardList,
} from '@tabler/icons-react';

export default function ClientInvoices() {
  const router = useRouter();
  const { selected } = router.query; // Get selected invoice ID from query params
  
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restaurantId, setRestaurantId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const [confirmationMessage, setConfirmationMessage] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [userName, setUserName] = useState("");

  const getUserInitials = (name) => {
    if (!name) return "U";
    return name.split(' ')
      .map(part => part.charAt(0))
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/client/login');
        return;
      }
      
      getRestaurantId();
    };
    checkUser();
  }, [router]);

  useEffect(() => {
    if (restaurantId) {
      fetchInvoices();
    }
  }, [restaurantId]);

  async function getRestaurantId() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError || !user) {
        console.error('Authentication error:', userError);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("restaurant_id, full_name")
        .eq("id", user.id)
        .single();

      if (error || !data?.restaurant_id) {
        console.error('Restaurant access error:', error);
        return;
      }

      setRestaurantId(data.restaurant_id);
      const firstName = data.full_name ? data.full_name.split(' ')[0] : "User";
      setUserName(firstName);
    } catch (err) {
      console.error('Unexpected error:', err);
    }
  }

  async function fetchInvoices() {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setInvoices(data || []);

      // Auto-select invoice if selected query parameter is provided
      if (selected && data) {
        const selectedInvoiceData = data.find(invoice => invoice.id === selected);
        if (selectedInvoiceData) {
          handleInvoiceSelect(selectedInvoiceData);
        }
      }
    } catch (error) {
      console.error('Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchInvoiceDetail(invoiceId) {
    try {
      setLoadingDetail(true);
      
      // Fetch invoice items
      const { data: itemsData, error: itemsError } = await supabase
        .from("invoice_items")
        .select(`
          *,
          ingredients (
            name,
            unit
          )
        `)
        .eq("invoice_id", invoiceId)
        .order("item_name");

      if (!itemsError) {
        setInvoiceItems(itemsData || []);
      }
    } catch (error) {
      console.error('Error fetching invoice detail:', error);
      setInvoiceItems([]);
    } finally {
      setLoadingDetail(false);
    }
  }

  function handleInvoiceSelect(invoice) {
    setSelectedInvoice(invoice);
    fetchInvoiceDetail(invoice.id);
    
    // Update URL without triggering a page reload
    router.replace(`/client/invoices?selected=${invoice.id}`, undefined, { shallow: true });
  }

  // Handle invoice selection from search
  function handleSearchInvoiceSelect(invoice) {
    handleInvoiceSelect(invoice);
  }

  // ... (keep all existing functions like handleDrag, handleDrop, etc.)

  function getInvoiceStatus(invoice) {
    const hasAllFields = invoice.number && invoice.date && invoice.supplier && invoice.amount;
    if (!hasAllFields) return { status: 'pending', label: 'Pending Review', color: 'bg-yellow-100 text-yellow-800' };
    return { status: 'processed', label: 'Processed', color: 'bg-green-100 text-green-800' };
  }

  function formatDate(dateString) {
    if (!dateString) return "Not provided";
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return "Invalid date";
    }
  }

  function formatCurrency(amount) {
    if (!amount || amount === null || amount === undefined) {
      return "--";
    }
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) {
      return "--";
    }
    
    return numAmount.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function calculateItemTotal(item) {
    const quantity = parseFloat(item.quantity) || 0;
    const unitCost = parseFloat(item.unit_cost) || 0;
    return quantity * unitCost;
  }

  const filteredAndSortedInvoices = invoices
    .filter(invoice => {
      const searchLower = searchTerm.toLowerCase();
      return (
        (invoice.number || '').toLowerCase().includes(searchLower) ||
        (invoice.supplier || '').toLowerCase().includes(searchLower)
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Loading Invoices</h3>
          <p className="text-gray-600">Fetching your invoice data...</p>
        </div>
      </div>
    );
  }

  const totalCalculated = invoiceItems.reduce((sum, item) => sum + calculateItemTotal(item), 0);

  return (
    <ClientLayout
      pageTitle="Invoices"
      pageDescription="Upload and manage your restaurant invoices"
      pageIcon={IconFileText}
    >
      {/* Header Section - Updated to use InvoiceSearch */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoice Center</h1>
          <p className="text-gray-600 text-sm mt-1">Track expenses and supplier payments</p>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Invoice Search Bar */}
          <div className="w-96">
            <InvoiceSearch 
              restaurantId={restaurantId}
              onInvoiceSelect={handleSearchInvoiceSelect}
              placeholder="Search invoices by number or supplier..."
            />
          </div>
          
          {/* Upload Button */}
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <IconUpload size={16} />
            Upload
          </button>
          
          {/* User Profile Circle */}
          <div className="flex items-center justify-center w-10 h-10 bg-blue-600 text-white rounded-full font-semibold text-sm cursor-pointer hover:bg-blue-700 transition-colors">
            {getUserInitials(userName)}
          </div>
        </div>
      </div>

      {/* Confirmation Message */}
      {confirmationMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <p className="text-green-800 font-medium">{confirmationMessage}</p>
        </div>
      )}

      {/* Main Layout - Split View */}
      <div className="flex gap-4 h-[calc(100vh-200px)]">
        
        {/* Invoice List - Left Side (55% width) */}
        <div className="w-[55%] bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 flex-shrink-0 bg-gradient-to-r from-blue-50 to-indigo-50">
            <h3 className="text-lg font-semibold text-gray-900">Invoice List</h3>
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-4 gap-4 p-4 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-900 flex-shrink-0">
            <div>Supplier</div>
            <div>Invoice No.</div>
            <div>Invoice Date</div>
            <div>Amount</div>
          </div>

          {/* Invoice List Content */}
          <div className="flex-1 overflow-y-auto">
            {filteredAndSortedInvoices.length === 0 ? (
              <div className="text-center py-12">
                <IconFileText size={48} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Invoices Found</h3>
                <p className="text-gray-600 mb-6">
                  {searchTerm 
                    ? `No invoices match "${searchTerm}"`
                    : 'Upload your first invoice to get started!'
                  }
                </p>
                {!searchTerm && (
                  <button
                    onClick={() => setShowUploadModal(true)}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Upload First Invoice
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {filteredAndSortedInvoices.map(invoice => (
                  <div 
                    key={invoice.id} 
                    className={`grid grid-cols-4 gap-4 p-3 rounded-lg cursor-pointer transition-all duration-200 ${
                      selectedInvoice?.id === invoice.id 
                        ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-300 shadow-sm' 
                        : 'hover:bg-gradient-to-r hover:from-gray-50 hover:to-blue-25 hover:shadow-sm'
                    }`}
                    onClick={() => handleInvoiceSelect(invoice)}
                  >
                    <div className="truncate">
                      <span className="text-sm text-gray-900">
                        {invoice.supplier || <span className="text-gray-400 italic">Pending</span>}
                      </span>
                    </div>
                    <div className="truncate">
                      <span className="text-sm text-gray-900">
                        {invoice.number || <span className="text-gray-400 italic">Pending</span>}
                      </span>
                    </div>
                    <div className="truncate">
                      <span className="text-sm text-gray-900">
                        {invoice.date ? new Date(invoice.date).toLocaleDateString() : <span className="text-gray-400 italic">Pending</span>}
                      </span>
                    </div>
                    <div className="truncate">
                      <span className="text-sm font-medium text-gray-900">
                        {invoice.amount ? formatCurrency(invoice.amount) : <span className="text-gray-400 italic">Pending</span>}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Invoice Detail - Right Side (45% width) */}
        <div className="w-[45%] bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
          {selectedInvoice ? (
            <>
              {/* Header */}
              <div className="p-4 border-b border-gray-200 flex-shrink-0 bg-gradient-to-r from-emerald-50 to-teal-50">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Invoice Detail</h3>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getInvoiceStatus(selectedInvoice).color}`}>
                    {getInvoiceStatus(selectedInvoice).label}
                  </span>
                </div>
              </div>

              {/* Detail Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Invoice Information */}
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-gray-900 border-b-2 border-blue-200 pb-2">Invoice Information</h4>
                  <div className="grid grid-cols-3 gap-6 bg-gradient-to-br from-gray-50 to-blue-50 p-4 rounded-lg">
                    {/* Row 1 */}
                    <div className="text-center">
                      <div className="text-sm font-bold text-blue-700 mb-2">Invoice No.</div>
                      <div className="text-sm text-gray-700">
                        {selectedInvoice.number || <span className="text-gray-400 italic">Pending Review</span>}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-blue-700 mb-2">Invoice Date</div>
                      <div className="text-sm text-gray-700">
                        {selectedInvoice.date ? formatDate(selectedInvoice.date) : <span className="text-gray-400 italic">Pending Review</span>}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-blue-700 mb-2">Supplier</div>
                      <div className="text-sm text-gray-700">
                        {selectedInvoice.supplier || <span className="text-gray-400 italic">Pending Review</span>}
                      </div>
                    </div>
                    
                    {/* Row 2 */}
                    <div className="text-center">
                      <div className="text-sm font-bold text-blue-700 mb-2">Upload Date</div>
                      <div className="text-sm text-gray-700">{formatDate(selectedInvoice.created_at)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-blue-700 mb-2">File</div>
                      <div className="text-sm text-gray-700">
                        {selectedInvoice.file_url ? (
                          <a
                            href={selectedInvoice.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded text-xs hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-sm"
                          >
                            View File
                            <IconExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="text-gray-400 italic">No file</span>
                        )}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-blue-700 mb-2">Total Amount</div>
                      <div className="text-lg font-bold text-emerald-600">
                        {selectedInvoice.amount ? formatCurrency(selectedInvoice.amount) : <span className="text-gray-400 italic">Pending Review</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Invoice Items */}
                {loadingDetail ? (
                  <div className="text-center py-8">
                    <div className="w-8 h-8 border-4 border-gray-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-2"></div>
                    <span className="text-gray-600">Loading items...</span>
                  </div>
                ) : invoiceItems.length > 0 ? (
                  <div className="space-y-4">
                    <h4 className="text-lg font-semibold text-gray-900 border-b-2 border-emerald-200 pb-2">Invoice Items ({invoiceItems.length})</h4>
                    <div className="space-y-3">
                      {invoiceItems.map((item) => (
                        <div key={item.id} className="border border-gray-200 rounded-lg p-3 bg-gradient-to-r from-gray-50 to-emerald-50 hover:from-gray-100 hover:to-emerald-100 transition-all duration-200">
                          <div className="flex justify-between items-center mb-2">
                            <h5 className="font-medium text-sm text-gray-900">{item.item_name || "--"}</h5>
                            <span className="font-bold text-sm text-emerald-600">{formatCurrency(calculateItemTotal(item))}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="flex justify-between">
                              <span className="text-gray-500">Quantity:</span>
                              <span className="text-gray-900">{item.quantity || "--"}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500">Unit:</span>
                              <span className="text-gray-900">{item.unit || "--"}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500">Unit Cost:</span>
                              <span className="text-gray-900">{formatCurrency(item.unit_cost)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500">Status:</span>
                              {item.ingredients ? (
                                <span className="text-emerald-700 bg-emerald-100 px-1 py-0.5 rounded text-xs font-medium">
                                  Linked
                                </span>
                              ) : (
                                <span className="text-orange-600 bg-orange-100 px-1 py-0.5 rounded text-xs">Not linked</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-gray-200 pt-3 bg-gradient-to-r from-emerald-50 to-blue-50 rounded-lg p-3">
                      <div className="flex justify-between text-sm font-bold text-gray-900">
                        <span>Calculated Total:</span>
                        <span className="text-emerald-600">{formatCurrency(totalCalculated)}</span>
                      </div>
                      {selectedInvoice.amount && Math.abs(totalCalculated - parseFloat(selectedInvoice.amount)) > 0.01 && (
                        <div className="flex justify-between text-red-600 text-xs mt-1 font-medium">
                          <span>Difference:</span>
                          <span>{formatCurrency(Math.abs(totalCalculated - parseFloat(selectedInvoice.amount)))}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : getInvoiceStatus(selectedInvoice).status === 'processed' ? (
                  <div className="text-center py-12">
                    <IconClipboardList size={48} className="mx-auto mb-4 text-gray-300" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Items Found</h3>
                    <p className="text-gray-600">This invoice has been processed but no line items were recorded.</p>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <IconClock size={48} className="mx-auto mb-4 text-yellow-500" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Pending Review</h3>
                    <p className="text-gray-600">This invoice is waiting to be processed. Items will be available once processing is complete.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <IconFileText size={64} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-xl font-medium text-gray-900 mb-2">Select an Invoice</h3>
                <p className="text-gray-600">Choose an invoice from the list to view its details</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Upload Modal - Keep existing upload modal code */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowUploadModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Upload Invoices</h2>
              <button className="text-gray-400 hover:text-gray-600" onClick={() => setShowUploadModal(false)} disabled={uploading}>
                <IconX size={24} />
              </button>
            </div>
            <div className="p-6">
              {/* Add your existing upload modal content here */}
              <div className="text-center py-8">
                <IconUpload size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-600">Upload modal content goes here</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </ClientLayout>
  );
}