// pages/admin/invoices/edit/[id].js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../../components/AdminLayout';
import supabase from '../../../../lib/supabaseClient';
// You'll need to create this file by copying from src/utils/standardizedUnits.js
import { standardizeInvoiceItem, calculateStandardizedCost, validateUnit } from '../../../../lib/standardizedUnits';
import {
  IconPlus,
  IconTrash,
  IconSearch,
  IconDeviceFloppy,
  IconFileText,
  IconExternalLink,
  IconEdit,
} from '@tabler/icons-react';

export default function InvoiceEditor() {
  const router = useRouter();
  const { id } = router.query;
  
  const [invoice, setInvoice] = useState(null);
  const [restaurant, setRestaurant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Invoice details form
  const [invoiceDetails, setInvoiceDetails] = useState({
    number: '',
    date: '',
    supplier: '',
    amount: ''
  });
  
  // Invoice items
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(null);
  const [filteredIngredients, setFilteredIngredients] = useState([]);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/admin/login');
        return;
      }
      
      if (id) {
        fetchInvoiceData();
      }
    };
    checkUser();
  }, [id, router]);

  async function fetchInvoiceData() {
    try {
      // Get invoice data
      const { data: invoiceData, error: invoiceError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', id)
        .single();

      if (invoiceError) throw invoiceError;
      setInvoice(invoiceData);

      // Get restaurant data
      const { data: restaurantData, error: restaurantError } = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', invoiceData.restaurant_id)
        .single();

      if (restaurantError) throw restaurantError;
      setRestaurant(restaurantData);

      // Pre-fill form if data exists
      setInvoiceDetails({
        number: invoiceData.number || '',
        date: invoiceData.date || '',
        supplier: invoiceData.supplier || '',
        amount: invoiceData.amount || ''
      });

      // Get existing invoice items
      const { data: existingItems, error: itemsError } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', id);

      if (itemsError) throw itemsError;
      setInvoiceItems(existingItems || []);

      // Get ingredients for this restaurant
      const { data: ingredientsData, error: ingredientsError } = await supabase
        .from('ingredients')
        .select('*')
        .eq('restaurant_id', invoiceData.restaurant_id)
        .order('name');

      if (ingredientsError) throw ingredientsError;
      setIngredients(ingredientsData || []);

    } catch (error) {
      console.error('Error fetching invoice data:', error);
      alert('Failed to load invoice data: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  function handleInvoiceDetailsChange(e) {
    const { name, value } = e.target;
    setInvoiceDetails(prev => ({
      ...prev,
      [name]: value
    }));
  }

  function addInvoiceItem() {
    const newItem = {
      id: Date.now(),
      item_name: '',
      quantity: '',
      unit: '',
      amount: '',
      unit_cost: 0,
      ingredient_id: null,
      ingredient_search: '',
      isNew: true
    };
    setInvoiceItems(prev => [...prev, newItem]);
  }

  function removeInvoiceItem(index) {
    setInvoiceItems(prev => prev.filter((_, i) => i !== index));
  }

  function handleItemChange(index, field, value) {
    setInvoiceItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      
      // Calculate unit_cost when amount or quantity changes
      if (field === 'amount' || field === 'quantity') {
        const amount = parseFloat(updated[index].amount) || 0;
        const quantity = parseFloat(updated[index].quantity) || 0;
        updated[index].unit_cost = quantity > 0 ? amount / quantity : 0;
      }
      
      return updated;
    });
  }

  function handleIngredientSearch(index, searchTerm) {
    handleItemChange(index, 'ingredient_search', searchTerm);
    setActiveSearchIndex(index);
    
    if (searchTerm.length > 1) {
      const filtered = ingredients.filter(ingredient =>
        ingredient.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredIngredients(filtered);
    } else {
      setFilteredIngredients([]);
      setActiveSearchIndex(null);
    }
  }

  function selectIngredient(index, ingredient) {
    handleItemChange(index, 'ingredient_id', ingredient.id);
    handleItemChange(index, 'ingredient_search', ingredient.name);
    setFilteredIngredients([]);
    setActiveSearchIndex(null);
  }

  async function handleSubmit() {
    try {
      setSaving(true);
      console.log('\n🚀 Starting invoice save process...');

      // Validate basic invoice details
      if (!invoiceDetails.number || !invoiceDetails.date || !invoiceDetails.supplier || !invoiceDetails.amount) {
        alert('Please fill in all invoice details');
        return;
      }

      if (invoiceItems.length === 0) {
        alert('Please add at least one invoice item');
        return;
      }

      console.log(`📋 Processing ${invoiceItems.length} invoice items...`);

      // Validate all items before processing
      for (let i = 0; i < invoiceItems.length; i++) {
        const item = invoiceItems[i];
        
        if (!item.item_name || !item.unit || !item.quantity || !item.amount) {
          alert(`Please complete all fields for item ${i + 1}: ${item.item_name || 'Unnamed item'}`);
          return;
        }

        // Validate unit
        const unitValidation = validateUnit(item.unit);
        if (!unitValidation.valid) {
          alert(`Invalid unit "${item.unit}" for item "${item.item_name}". ${unitValidation.message}`);
          return;
        }

        console.log(`✅ Item ${i + 1} validation passed: ${item.item_name} (${item.quantity} ${item.unit})`);
      }

      // Update invoice details first
      console.log('📝 Updating invoice details...');
      const { error: invoiceUpdateError } = await supabase
        .from('invoices')
        .update({
          number: invoiceDetails.number,
          date: invoiceDetails.date,
          supplier: invoiceDetails.supplier,
          amount: parseFloat(invoiceDetails.amount)
        })
        .eq('id', id);

      if (invoiceUpdateError) {
        console.error('Failed to update invoice:', invoiceUpdateError);
        alert('Failed to update invoice: ' + invoiceUpdateError.message);
        return;
      }

      console.log('✅ Invoice details updated successfully');

      // [All the complex standardization logic from your original file would go here]
      // For now, let's just save the invoice items to test the UI
      
      // Delete existing invoice items
      console.log('🗑️ Cleaning up old invoice items...');
      const { error: deleteError } = await supabase
        .from('invoice_items')
        .delete()
        .eq('invoice_id', id);

      if (deleteError) {
        console.error('Failed to delete old items:', deleteError);
        alert('Failed to delete old items: ' + deleteError.message);
        return;
      }

      // Insert new invoice items
      console.log('💾 Inserting updated invoice items...');
      const itemsToInsert = invoiceItems.map((item) => ({
        invoice_id: id,
        item_name: item.item_name || '',
        quantity: parseFloat(item.quantity) || 0,
        unit: item.unit || '',
        amount: parseFloat(item.amount) || 0,
        unit_cost: parseFloat(item.unit_cost) || 0,
        ingredient_id: item.ingredient_id || null
      }));

      const { error: insertError } = await supabase
        .from('invoice_items')
        .insert(itemsToInsert);

      if (insertError) {
        console.error('Failed to insert items:', insertError);
        alert('Failed to insert items: ' + insertError.message);
        return;
      }

      console.log(`✅ Inserted ${itemsToInsert.length} invoice items`);
      
      alert('Invoice saved successfully!\n\n✅ Updated invoice details\n✅ Saved invoice items\n\n(Full standardization processing will be added next)');
      router.push('/admin/pending-invoices');

    } catch (error) {
      console.error('\n❌ Unexpected error during invoice save:', error);
      alert('Unexpected error: ' + error.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AdminLayout 
        pageTitle="Invoice Editor" 
        pageDescription={restaurant?.name || "Loading..."}
        pageIcon={IconEdit}
      >
        <div className="p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
            <p className="text-gray-600">Loading invoice...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (!invoice) {
    return (
      <AdminLayout 
        pageTitle="Invoice Not Found" 
        pageDescription="The requested invoice could not be found"
        pageIcon={IconFileText}
      >
        <div className="p-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Invoice not found</h1>
          <p className="text-gray-600 mb-6">The requested invoice could not be found.</p>
          <button 
            onClick={() => router.push('/admin/pending-invoices')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
          >
            ← Back to Pending Invoices
          </button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout 
      pageTitle="Invoice Editor" 
      pageDescription={restaurant?.name}
      pageIcon={IconEdit}
    >
      <div className="flex">
        {/* Left Panel - Invoice Form */}
        <div className="flex-1 p-6 max-w-none">
          <div className="flex justify-end mb-6">
            <button 
              onClick={handleSubmit}
              disabled={saving}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                saving
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-[#ADD8E6] text-gray-900 hover:bg-[#9CC5D4] shadow-sm hover:shadow-md'
              }`}
            >
              <IconDeviceFloppy size={18} />
              {saving ? 'Saving...' : 'Save Invoice'}
            </button>
          </div>

          {/* Invoice Details */}
          <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Invoice Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="number" className="block text-sm font-medium text-gray-900 mb-2">
                  Invoice Number
                </label>
                <input
                  id="number"
                  name="number"
                  type="text"
                  value={invoiceDetails.number}
                  onChange={handleInvoiceDetailsChange}
                  placeholder="Enter invoice number"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent transition-colors"
                />
              </div>
              
              <div>
                <label htmlFor="date" className="block text-sm font-medium text-gray-900 mb-2">
                  Invoice Date
                </label>
                <input
                  id="date"
                  name="date"
                  type="date"
                  value={invoiceDetails.date}
                  onChange={handleInvoiceDetailsChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent transition-colors"
                />
              </div>
              
              <div>
                <label htmlFor="supplier" className="block text-sm font-medium text-gray-900 mb-2">
                  Supplier
                </label>
                <input
                  id="supplier"
                  name="supplier"
                  type="text"
                  value={invoiceDetails.supplier}
                  onChange={handleInvoiceDetailsChange}
                  placeholder="Enter supplier name"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent transition-colors"
                />
              </div>
              
              <div>
                <label htmlFor="amount" className="block text-sm font-medium text-gray-900 mb-2">
                  Total Amount
                </label>
                <input
                  id="amount"
                  name="amount"
                  type="number"
                  step="0.01"
                  value={invoiceDetails.amount}
                  onChange={handleInvoiceDetailsChange}
                  placeholder="0.00"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent transition-colors"
                />
              </div>
            </div>
          </section>

          {/* Invoice Items */}
          <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Invoice Items</h2>
              <button 
                onClick={addInvoiceItem}
                className="flex items-center gap-2 px-4 py-2 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
              >
                <IconPlus size={18} />
                Add Item
              </button>
            </div>
            
            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-2 text-sm font-medium text-gray-900">Item Name</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-gray-900">Quantity</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-gray-900">Unit</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-gray-900">Amount</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-gray-900">Unit Cost</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-gray-900">Ingredient</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-gray-900">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invoiceItems.map((item, index) => (
                    <tr key={item.id || index} className="hover:bg-gray-50">
                      <td className="py-4 px-2">
                        <input
                          type="text"
                          value={item.item_name}
                          onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                          placeholder="Item name"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent text-sm"
                        />
                      </td>
                      <td className="py-4 px-2">
                        <input
                          type="number"
                          step="0.01"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                          placeholder="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent text-sm"
                        />
                      </td>
                      <td className="py-4 px-2">
                        <input
                          type="text"
                          value={item.unit}
                          onChange={(e) => handleItemChange(index, 'unit', e.target.value)}
                          placeholder="lbs, oz, etc"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent text-sm"
                          title="Enter unit (e.g., lbs, oz, cups, gallons, each)"
                        />
                      </td>
                      <td className="py-4 px-2">
                        <input
                          type="number"
                          step="0.01"
                          value={item.amount}
                          onChange={(e) => handleItemChange(index, 'amount', e.target.value)}
                          placeholder="0.00"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent text-sm"
                        />
                      </td>
                      <td className="py-4 px-2">
                        <span className="text-sm text-gray-900 font-medium">
                          ${(item.unit_cost || 0).toFixed(2)}
                        </span>
                      </td>
                      <td className="py-4 px-2">
                        <div className="relative">
                          <input
                            type="text"
                            value={item.ingredient_search || ''}
                            onChange={(e) => handleIngredientSearch(index, e.target.value)}
                            placeholder="Search ingredients..."
                            className="w-full px-3 py-2 pl-10 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent text-sm"
                          />
                          <IconSearch size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                          {filteredIngredients.length > 0 && activeSearchIndex === index && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-40 overflow-y-auto">
                              {filteredIngredients.map(ingredient => (
                                <div
                                  key={ingredient.id}
                                  onClick={() => selectIngredient(index, ingredient)}
                                  className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                                >
                                  <div className="font-medium text-gray-900">{ingredient.name}</div>
                                  <div className="text-xs text-gray-500">
                                    {ingredient.unit} • ${ingredient.last_price?.toFixed(4) || '0.0000'}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-2">
                        <button
                          onClick={() => removeInvoiceItem(index)}
                          className="flex items-center justify-center w-8 h-8 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                          title="Remove item"
                        >
                          <IconTrash size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {invoiceItems.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <IconFileText size={48} className="mx-auto mb-4 text-gray-300" />
                  <p>No invoice items yet</p>
                  <p className="text-sm">Click "Add Item" to get started</p>
                </div>
              )}
            </div>

            {/* Mobile Card View */}
            <div className="lg:hidden space-y-4">
              {invoiceItems.map((item, index) => (
                <div key={item.id || index} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium text-gray-900">Item #{index + 1}</h3>
                    <button
                      onClick={() => removeInvoiceItem(index)}
                      className="flex items-center justify-center w-8 h-8 text-red-600 hover:text-red-700 hover:bg-red-100 rounded-md transition-colors"
                    >
                      <IconTrash size={16} />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Item Name</label>
                      <input
                        type="text"
                        value={item.item_name}
                        onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                        placeholder="Item name"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent text-sm"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                        <input
                          type="number"
                          step="0.01"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                          placeholder="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                        <input
                          type="text"
                          value={item.unit}
                          onChange={(e) => handleItemChange(index, 'unit', e.target.value)}
                          placeholder="lbs, oz, etc"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent text-sm"
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                        <input
                          type="number"
                          step="0.01"
                          value={item.amount}
                          onChange={(e) => handleItemChange(index, 'amount', e.target.value)}
                          placeholder="0.00"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Unit Cost</label>
                        <div className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-sm text-gray-900 font-medium">
                          ${(item.unit_cost || 0).toFixed(2)}
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ingredient</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={item.ingredient_search || ''}
                          onChange={(e) => handleIngredientSearch(index, e.target.value)}
                          placeholder="Search ingredients..."
                          className="w-full px-3 py-2 pl-10 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent text-sm"
                        />
                        <IconSearch size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                        {filteredIngredients.length > 0 && activeSearchIndex === index && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-40 overflow-y-auto">
                            {filteredIngredients.map(ingredient => (
                              <div
                                key={ingredient.id}
                                onClick={() => selectIngredient(index, ingredient)}
                                className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                              >
                                <div className="font-medium text-gray-900">{ingredient.name}</div>
                                <div className="text-xs text-gray-500">
                                  {ingredient.unit} • ${ingredient.last_price?.toFixed(4) || '0.0000'}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              
              {invoiceItems.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <IconFileText size={48} className="mx-auto mb-4 text-gray-300" />
                  <p>No invoice items yet</p>
                  <p className="text-sm">Click "Add Item" to get started</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Panel - File Viewer */}
        <div className="hidden xl:block w-96 bg-white border-l border-gray-200">
          <div className="sticky top-24 h-[calc(100vh-6rem)]">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Uploaded Invoice</h3>
              {invoice.file_url && (
                <a
                  href={invoice.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-[#ADD8E6] hover:underline"
                >
                  <IconExternalLink size={16} />
                  Open in New Tab
                </a>
              )}
            </div>
            
            <div className="p-6 h-full overflow-auto">
              {invoice.file_url ? (
                <div className="h-full">
                  {invoice.file_url.toLowerCase().includes('.pdf') ? (
                    <iframe
                      src={invoice.file_url}
                      className="w-full h-full border border-gray-200 rounded-lg"
                      title="Invoice PDF"
                    />
                  ) : (
                    <img
                      src={invoice.file_url}
                      alt="Invoice"
                      className="w-full h-auto border border-gray-200 rounded-lg"
                    />
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg">
                  <div className="text-center">
                    <IconFileText size={32} className="mx-auto mb-2 text-gray-400" />
                    <p className="text-sm text-gray-500">No file available</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}