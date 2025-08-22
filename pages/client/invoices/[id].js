// pages/client/invoices/[id].js
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import ClientLayout from "../../../components/ClientLayout";
import supabase from "../../../lib/supabaseClient";
import {
  IconFileText,
  IconArrowLeft,
  IconExternalLink,
  IconClipboardList,
  IconClock,
  IconCheck,
  IconAlertTriangle,
} from '@tabler/icons-react';

export default function InvoiceDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [invoice, setInvoice] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restaurant, setRestaurant] = useState(null);

  useEffect(() => {
    if (id) {
      fetchInvoiceData();
    }
  }, [id]);

  async function fetchInvoiceData() {
    try {
      setLoading(true);
      setError("");

      // First, verify user has access to this invoice
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        setError("Authentication required");
        return;
      }

      // Get user's restaurant_id
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("restaurant_id")
        .eq("id", user.id)
        .single();

      if (profileError || !profile?.restaurant_id) {
        setError("Could not determine restaurant access");
        return;
      }

      // Fetch invoice with restaurant verification
      const { data: invoiceData, error: invoiceError } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", id)
        .eq("restaurant_id", profile.restaurant_id)
        .single();

      if (invoiceError) {
        if (invoiceError.code === 'PGRST116') {
          setError("Invoice not found or access denied");
        } else {
          setError("Failed to fetch invoice: " + invoiceError.message);
        }
        return;
      }

      setInvoice(invoiceData);

      // Fetch restaurant info
      const { data: restaurantData, error: restaurantError } = await supabase
        .from("restaurants")
        .select("*")
        .eq("id", profile.restaurant_id)
        .single();

      if (!restaurantError && restaurantData) {
        setRestaurant(restaurantData);
      }

      // Fetch invoice items if they exist
      const { data: itemsData, error: itemsError } = await supabase
        .from("invoice_items")
        .select(`
          *,
          ingredients (
            name,
            unit
          )
        `)
        .eq("invoice_id", id)
        .order("item_name");

      if (!itemsError) {
        setInvoiceItems(itemsData || []);
      }

    } catch (err) {
      setError("An unexpected error occurred: " + err.message);
      console.error("Error fetching invoice data:", err);
    } finally {
      setLoading(false);
    }
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

  function getProcessingStatus() {
    if (!invoice) return 'unknown';
    const hasAllFields = invoice.number && invoice.date && invoice.supplier && invoice.amount;
    return hasAllFields ? 'processed' : 'pending';
  }

  if (loading) {
    return React.createElement(
      ClientLayout,
      {
        pageTitle: "Invoice Details",
        pageDescription: "View invoice information and items",
        pageIcon: IconFileText
      },
      React.createElement(
        'div',
        { className: "p-6" },
        React.createElement(
          'div',
          { className: "flex items-center justify-center py-12" },
          React.createElement('div', { className: "w-10 h-10 border-4 border-gray-300 border-t-blue-600 rounded-full animate-spin" }),
          React.createElement('span', { className: "ml-3 text-gray-600" }, "Loading invoice details...")
        )
      )
    );
  }

  if (error) {
    return React.createElement(
      ClientLayout,
      {
        pageTitle: "Invoice Details",
        pageDescription: "View invoice information and items",
        pageIcon: IconFileText
      },
      React.createElement(
        'div',
        { className: "p-6" },
        React.createElement(
          'div',
          { className: "text-center py-12" },
          React.createElement('div', { className: "text-6xl mb-4" }, "⚠️"),
          React.createElement('h3', { className: "text-xl font-semibold text-gray-900 mb-2" }, "Error Loading Invoice"),
          React.createElement('p', { className: "text-red-600 mb-6" }, error),
          React.createElement(
            'div',
            { className: "flex gap-4 justify-center" },
            React.createElement(
              'button',
              {
                onClick: () => router.push("/client/invoices"),
                className: "px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              },
              "Back to Invoices"
            ),
            React.createElement(
              'button',
              {
                onClick: () => window.location.reload(),
                className: "px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              },
              "Retry"
            )
          )
        )
      )
    );
  }

  if (!invoice) {
    return React.createElement(
      ClientLayout,
      {
        pageTitle: "Invoice Details",
        pageDescription: "View invoice information and items",
        pageIcon: IconFileText
      },
      React.createElement(
        'div',
        { className: "p-6" },
        React.createElement(
          'div',
          { className: "text-center py-12" },
          React.createElement('div', { className: "text-6xl mb-4" }, "📄"),
          React.createElement('h3', { className: "text-xl font-semibold text-gray-900 mb-2" }, "Invoice Not Found"),
          React.createElement('p', { className: "text-gray-600 mb-6" }, "The requested invoice could not be found."),
          React.createElement(
            'button',
            {
              onClick: () => router.push("/client/invoices"),
              className: "px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            },
            "Back to Invoices"
          )
        )
      )
    );
  }

  const status = getProcessingStatus();
  const totalCalculated = invoiceItems.reduce((sum, item) => sum + calculateItemTotal(item), 0);

  return React.createElement(
    ClientLayout,
    {
      pageTitle: "Invoice Details",
      pageDescription: "View invoice information and items",
      pageIcon: IconFileText
    },
    React.createElement(
      React.Fragment,
      null,
      // Header with back button
      React.createElement(
        'div',
        { className: "bg-white border-b border-gray-200 px-6 py-4" },
        React.createElement(
          'div',
          { className: "flex items-center justify-between" },
          React.createElement(
            'button',
            {
              onClick: () => router.push("/client/invoices"),
              className: "flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            },
            React.createElement(IconArrowLeft, { size: 20 }),
            React.createElement('span', null, "Back to Invoices")
          ),
          React.createElement(
            'div',
            { className: "flex items-center gap-3" },
            React.createElement(
              'span',
              {
                className: `inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                  status === 'processed' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-yellow-100 text-yellow-800'
                }`
              },
              status === 'processed' ? 'Processed' : 'Pending Review'
            )
          )
        )
      ),

      React.createElement(
        'div',
        { className: "p-6 max-w-6xl mx-auto space-y-6" },
        
        // Invoice Information Card
        React.createElement(
          'div',
          { className: "bg-white border border-gray-200 rounded-xl p-6 shadow-sm" },
          React.createElement(
            'div',
            { className: "flex items-center justify-between mb-6" },
            React.createElement('h2', { className: "text-lg font-semibold text-gray-900" }, "Invoice Information"),
            restaurant && React.createElement(
              'span',
              { className: "text-sm font-medium text-gray-600 bg-gray-100 px-3 py-1 rounded-full" },
              restaurant.name
            )
          ),
          React.createElement(
            'div',
            { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" },
            React.createElement(
              'div',
              { className: "space-y-1" },
              React.createElement('label', { className: "text-sm font-medium text-gray-500" }, "Invoice Number"),
              React.createElement(
                'p',
                { className: "text-lg text-gray-900" },
                invoice.number || React.createElement('span', { className: "text-gray-400 italic" }, "Pending Review")
              )
            ),
            React.createElement(
              'div',
              { className: "space-y-1" },
              React.createElement('label', { className: "text-sm font-medium text-gray-500" }, "Invoice Date"),
              React.createElement(
                'p',
                { className: "text-lg text-gray-900" },
                invoice.date ? formatDate(invoice.date) : React.createElement('span', { className: "text-gray-400 italic" }, "Pending Review")
              )
            ),
            React.createElement(
              'div',
              { className: "space-y-1" },
              React.createElement('label', { className: "text-sm font-medium text-gray-500" }, "Supplier"),
              React.createElement(
                'p',
                { className: "text-lg text-gray-900" },
                invoice.supplier || React.createElement('span', { className: "text-gray-400 italic" }, "Pending Review")
              )
            ),
            React.createElement(
              'div',
              { className: "space-y-1" },
              React.createElement('label', { className: "text-sm font-medium text-gray-500" }, "Total Amount"),
              React.createElement(
                'p',
                { className: "text-2xl font-bold text-gray-900" },
                invoice.amount ? formatCurrency(invoice.amount) : React.createElement('span', { className: "text-gray-400 italic" }, "Pending Review")
              )
            ),
            React.createElement(
              'div',
              { className: "space-y-1" },
              React.createElement('label', { className: "text-sm font-medium text-gray-500" }, "Upload Date"),
              React.createElement('p', { className: "text-lg text-gray-900" }, formatDate(invoice.created_at))
            ),
            React.createElement(
              'div',
              { className: "space-y-1" },
              React.createElement('label', { className: "text-sm font-medium text-gray-500" }, "File"),
              invoice.file_url ? React.createElement(
                'div',
                null,
                React.createElement(
                  'a',
                  {
                    href: invoice.file_url,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    className: "inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                  },
                  "View Original File",
                  React.createElement(IconExternalLink, { size: 16 })
                )
              ) : React.createElement('span', { className: "text-gray-400 italic" }, "No file available")
            )
          )
        ),

        // Invoice Items Card
        invoiceItems.length > 0 && React.createElement(
          'div',
          { className: "bg-white border border-gray-200 rounded-xl p-6 shadow-sm" },
          React.createElement(
            'div',
            { className: "flex items-center justify-between mb-6" },
            React.createElement('h2', { className: "text-lg font-semibold text-gray-900" }, "Invoice Items"),
            React.createElement(
              'span',
              { className: "text-sm font-medium text-gray-600 bg-gray-100 px-3 py-1 rounded-full" },
              `${invoiceItems.length} items`
            )
          ),
          React.createElement(
            'div',
            { className: "overflow-x-auto" },
            React.createElement(
              'table',
              { className: "w-full" },
              React.createElement(
                'thead',
                { className: "bg-gray-50 border-b border-gray-200" },
                React.createElement(
                  'tr',
                  null,
                  React.createElement('th', { className: "text-left py-3 px-4 text-sm font-medium text-gray-900" }, "Item Name"),
                  React.createElement('th', { className: "text-left py-3 px-4 text-sm font-medium text-gray-900" }, "Quantity"),
                  React.createElement('th', { className: "text-left py-3 px-4 text-sm font-medium text-gray-900" }, "Unit"),
                  React.createElement('th', { className: "text-left py-3 px-4 text-sm font-medium text-gray-900" }, "Unit Cost"),
                  React.createElement('th', { className: "text-left py-3 px-4 text-sm font-medium text-gray-900" }, "Total"),
                  React.createElement('th', { className: "text-left py-3 px-4 text-sm font-medium text-gray-900" }, "Linked Ingredient")
                )
              ),
              React.createElement(
                'tbody',
                { className: "divide-y divide-gray-100" },
                invoiceItems.map((item) =>
                  React.createElement(
                    'tr',
                    { key: item.id, className: "hover:bg-gray-50" },
                    React.createElement(
                      'td',
                      { className: "py-4 px-4 font-medium text-gray-900" },
                      item.item_name || "--"
                    ),
                    React.createElement(
                      'td',
                      { className: "py-4 px-4 text-gray-900" },
                      item.quantity || "--"
                    ),
                    React.createElement(
                      'td',
                      { className: "py-4 px-4 text-gray-900" },
                      item.unit || "--"
                    ),
                    React.createElement(
                      'td',
                      { className: "py-4 px-4 text-gray-900" },
                      formatCurrency(item.unit_cost)
                    ),
                    React.createElement(
                      'td',
                      { className: "py-4 px-4 font-medium text-gray-900" },
                      formatCurrency(calculateItemTotal(item))
                    ),
                    React.createElement(
                      'td',
                      { className: "py-4 px-4" },
                      item.ingredients ? React.createElement(
                        'span',
                        { className: "text-green-700 bg-green-50 px-2 py-1 rounded text-sm" },
                        item.ingredients.name
                      ) : React.createElement(
                        'span',
                        { className: "text-gray-500 italic" },
                        "Not linked"
                      )
                    )
                  )
                )
              ),
              React.createElement(
                'tfoot',
                { className: "bg-gray-50 border-t border-gray-200" },
                React.createElement(
                  'tr',
                  null,
                  React.createElement(
                    'td',
                    { colSpan: 4, className: "py-4 px-4 font-semibold text-gray-900" },
                    "Calculated Total:"
                  ),
                  React.createElement(
                    'td',
                    { className: "py-4 px-4 font-bold text-gray-900" },
                    formatCurrency(totalCalculated)
                  ),
                  React.createElement('td', { className: "py-4 px-4" })
                ),
                invoice.amount && Math.abs(totalCalculated - parseFloat(invoice.amount)) > 0.01 && React.createElement(
                  'tr',
                  null,
                  React.createElement(
                    'td',
                    { colSpan: 4, className: "py-2 px-4 text-gray-700" },
                    "Invoice Total:"
                  ),
                  React.createElement(
                    'td',
                    { className: "py-2 px-4 text-gray-900" },
                    formatCurrency(invoice.amount)
                  ),
                  React.createElement(
                    'td',
                    { className: "py-2 px-4" },
                    React.createElement(
                      'span',
                      { className: "text-red-600 text-sm" },
                      `Difference: ${formatCurrency(Math.abs(totalCalculated - parseFloat(invoice.amount)))}`
                    )
                  )
                )
              )
            )
          )
        ),

        // Empty items state
        invoiceItems.length === 0 && status === 'processed' && React.createElement(
          'div',
          { className: "bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm" },
          React.createElement(IconClipboardList, { size: 48, className: "mx-auto mb-4 text-gray-300" }),
          React.createElement('h3', { className: "text-lg font-medium text-gray-900 mb-2" }, "No Items Found"),
          React.createElement('p', { className: "text-gray-600" }, "This invoice has been processed but no line items were recorded.")
        ),

        // Pending processing message
        status === 'pending' && React.createElement(
          'div',
          { className: "bg-yellow-50 border border-yellow-200 rounded-xl p-8 text-center" },
          React.createElement(IconClock, { size: 48, className: "mx-auto mb-4 text-yellow-500" }),
          React.createElement('h3', { className: "text-lg font-medium text-gray-900 mb-2" }, "Pending Review"),
          React.createElement('p', { className: "text-gray-600" }, "This invoice is waiting to be processed by our admin team. Invoice details and line items will be available once processing is complete.")
        ),

        // File Viewer
        invoice.file_url && React.createElement(
          'div',
          { className: "bg-white border border-gray-200 rounded-xl p-6 shadow-sm" },
          React.createElement(
            'div',
            { className: "flex items-center justify-between mb-6" },
            React.createElement('h2', { className: "text-lg font-semibold text-gray-900" }, "Invoice File"),
            React.createElement(
              'a',
              {
                href: invoice.file_url,
                target: "_blank",
                rel: "noopener noreferrer",
                className: "inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              },
              "Open in New Tab",
              React.createElement(IconExternalLink, { size: 16 })
            )
          ),
          React.createElement(
            'div',
            { className: "border border-gray-200 rounded-lg overflow-hidden" },
            invoice.file_url.toLowerCase().includes('.pdf') ? React.createElement('iframe', {
              src: invoice.file_url,
              className: "w-full h-96",
              title: "Invoice PDF"
            }) : React.createElement('img', {
              src: invoice.file_url,
              alt: "Invoice",
              className: "w-full h-auto max-h-96 object-contain"
            })
          )
        )
      )
    )
  );
}