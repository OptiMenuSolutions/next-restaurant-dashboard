// pages/admin/prospective-clients.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconSearch,
  IconUsers,
  IconCalendar,
  IconBuilding,
  IconSortAscending,
  IconSortDescending,
  IconMail,
  IconPhone,
  IconRefresh,
  IconPlus,
  IconEye,
  IconEdit,
  IconTrash,
  IconUserPlus,
  IconClock,
  IconNotes,
} from '@tabler/icons-react';
import { logActivity, ACTIVITY_TYPES } from '../../lib/activityLogger';

export default function ProspectiveClientManagement() {
  const router = useRouter();
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('restaurant_name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProspect, setEditingProspect] = useState(null);
  const [viewingProspect, setViewingProspect] = useState(null);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/admin/login');
        return;
      }
      
      fetchProspects();
    };
    checkUser();
  }, [router]);

  async function fetchProspects() {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('prospective_clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProspects(data || []);
    } catch (error) {
      console.error('Error fetching prospective clients:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Are you sure you want to delete this prospective client?')) {
      return;
    }

    try {
      // Get prospect info before deleting
      const prospect = prospects.find(p => p.id === id);
      
      const { error } = await supabase
        .from('prospective_clients')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      // Log activity
      await logActivity({
        activityType: ACTIVITY_TYPES.PROSPECT_DELETED,
        title: `Prospect "${prospect?.restaurant_name}" removed`,
        subtitle: `Contact: ${prospect?.contact_name || 'Not provided'}`,
        details: `Removed from prospective clients pipeline`,
        metadata: { prospect_id: id }
      });
      
      setProspects(prev => prev.filter(p => p.id !== id));
      alert('Prospective client deleted successfully');
    } catch (error) {
      console.error('Error deleting prospect:', error);
      alert('Failed to delete prospective client: ' + error.message);
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

  const filteredAndSortedProspects = prospects
    .filter(prospect => 
      prospect.restaurant_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (prospect.contact_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (prospect.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (prospect.phone_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (prospect.city || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (prospect.state || '').toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      let aValue = a[sortField];
      let bValue = b[sortField];
      
      if (sortField === 'last_contacted_date') {
        aValue = aValue ? new Date(aValue) : new Date(0);
        bValue = bValue ? new Date(bValue) : new Date(0);
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      
      if (sortField === 'created_at') {
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

  const totalProspects = prospects.length;
  const recentlyContacted = prospects.filter(prospect => 
    prospect.last_contacted_date && 
    new Date(prospect.last_contacted_date) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  ).length;
  const needsFollowUp = prospects.filter(prospect => 
    !prospect.last_contacted_date || 
    new Date(prospect.last_contacted_date) < new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  ).length;

  if (loading) {
    return (
      <AdminLayout 
        pageTitle="Prospective Clients" 
        pageDescription="Manage potential restaurant partners and leads"
        pageIcon={IconUserPlus}
      >
        <div className="p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-gray-300 border-t-[#ADD8E6] rounded-full animate-spin"></div>
            <div className="text-gray-600">Loading prospects...</div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout 
      pageTitle="Prospective Clients" 
      pageDescription="Manage potential restaurant partners and leads"
      pageIcon={IconUserPlus}
    >
      {/* Action Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              onClick={fetchProspects}
            >
              <IconRefresh size={18} />
              Refresh
            </button>
            <button 
              className="flex items-center gap-2 px-3 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
              onClick={() => router.push('/admin/clients')}
            >
              <IconUsers size={18} />
              View Current Clients
            </button>
          </div>
          <button 
            className="flex items-center gap-2 px-4 py-2 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
            onClick={() => setShowAddModal(true)}
          >
            <IconPlus size={18} />
            Add Prospect
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
              placeholder="Search by restaurant name, contact, email, phone, city, or state..."
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
                <IconUserPlus size={24} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{totalProspects}</p>
                <p className="text-gray-600">Total Prospects</p>
                <p className="text-sm text-gray-500">Potential partners</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg">
                <IconClock size={24} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{recentlyContacted}</p>
                <p className="text-gray-600">Recently Contacted</p>
                <p className="text-sm text-gray-500">Within 30 days</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-orange-100 rounded-lg">
                <IconCalendar size={24} className="text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{needsFollowUp}</p>
                <p className="text-gray-600">Needs Follow-up</p>
                <p className="text-sm text-gray-500">14+ days since contact</p>
              </div>
            </div>
          </div>
        </div>

        {/* Prospects Table */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">🎯 Prospective Clients</h3>
                <p className="text-gray-600">{filteredAndSortedProspects.length} prospects</p>
              </div>
            </div>
          </div>

          {filteredAndSortedProspects.length === 0 ? (
            <div className="text-center py-12">
              <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6">
                <IconUserPlus size={32} className="text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                {searchTerm ? 'No Prospects Found' : 'No Prospective Clients Yet'}
              </h3>
              <p className="text-gray-600 mb-6">
                {searchTerm 
                  ? `No prospects match "${searchTerm}"`
                  : 'Start building your pipeline by adding potential restaurant partners.'
                }
              </p>
              {!searchTerm && (
                <button 
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
                  onClick={() => setShowAddModal(true)}
                >
                  <IconPlus size={18} />
                  Add Your First Prospect
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
                        onClick={() => handleSort('restaurant_name')}
                      >
                        <div className="flex items-center gap-2">
                          Restaurant Name
                          {sortField === 'restaurant_name' && (
                            sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th 
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('contact_name')}
                      >
                        <div className="flex items-center gap-2">
                          Contact Name
                          {sortField === 'contact_name' && (
                            sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Phone</th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Email</th>
                      <th 
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('city')}
                      >
                        <div className="flex items-center gap-2">
                          Location
                          {sortField === 'city' && (
                            sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th 
                        className="text-left py-4 px-6 text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('last_contacted_date')}
                      >
                        <div className="flex items-center gap-2">
                          Last Contacted
                          {sortField === 'last_contacted_date' && (
                            sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />
                          )}
                        </div>
                      </th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredAndSortedProspects.map(prospect => {
                      const needsFollowUp = !prospect.last_contacted_date || 
                        new Date(prospect.last_contacted_date) < new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
                      
                      return (
                        <tr 
                          key={prospect.id} 
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => {
                            console.log('Row clicked!', prospect.restaurant_name);
                            setViewingProspect(prospect);
                          }}
                        >
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-lg">
                                <IconBuilding size={18} className="text-blue-600" />
                              </div>
                              <div>
                                <div className="font-medium text-gray-900">{prospect.restaurant_name}</div>
                                {needsFollowUp && (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                    Needs Follow-up
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <span className="text-gray-900">
                              {prospect.contact_name || <span className="text-gray-400 italic">Not provided</span>}
                            </span>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <IconPhone size={16} className="text-gray-400" />
                              <span className="text-gray-900">
                                {prospect.phone_number || <span className="text-gray-400 italic">Not provided</span>}
                              </span>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <IconMail size={16} className="text-gray-400" />
                              <span className="text-gray-900">
                                {prospect.email || <span className="text-gray-400 italic">Not provided</span>}
                              </span>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="text-gray-900">
                              {prospect.city && prospect.state ? (
                                <div>
                                  <div className="font-medium">{prospect.city}, {prospect.state}</div>
                                  {prospect.zipcode && (
                                    <div className="text-sm text-gray-500">{prospect.zipcode}</div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-400 italic">Not provided</span>
                              )}
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <IconCalendar size={16} className="text-gray-400" />
                              <span className="text-gray-900">
                                {prospect.last_contacted_date 
                                  ? new Date(prospect.last_contacted_date).toLocaleDateString()
                                  : <span className="text-gray-400 italic">Never</span>
                                }
                              </span>
                            </div>
                          </td>
                          
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <button
                                className="flex items-center gap-1 px-3 py-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors text-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingProspect(prospect);
                                }}
                              >
                                <IconEdit size={16} />
                                Edit
                              </button>
                              <button
                                className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors text-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(prospect.id);
                                }}
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

              {/* Mobile Cards */}
              <div className="lg:hidden">
                {filteredAndSortedProspects.map(prospect => {
                  const needsFollowUp = !prospect.last_contacted_date || 
                    new Date(prospect.last_contacted_date) < new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
                  
                  return (
                    <div 
                      key={prospect.id} 
                      className="p-6 border-b border-gray-200 last:border-b-0 cursor-pointer hover:bg-gray-50"
                      onClick={() => setViewingProspect(prospect)}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg">
                            <IconBuilding size={20} className="text-blue-600" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">{prospect.restaurant_name}</h3>
                            <div className="text-sm text-gray-500">{prospect.contact_name || 'No contact name'}</div>
                          </div>
                        </div>
                        
                        {needsFollowUp && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                            Follow-up
                          </span>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-1 gap-3 mb-4">
                        <div className="flex items-center gap-2 text-sm">
                          <IconPhone size={14} className="text-gray-400" />
                          <span className="text-gray-900">{prospect.phone_number || 'No phone'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <IconMail size={14} className="text-gray-400" />
                          <span className="text-gray-900">{prospect.email || 'No email'}</span>
                        </div>
                        {(prospect.city || prospect.state) && (
                          <div className="flex items-center gap-2 text-sm">
                            <IconBuilding size={14} className="text-gray-400" />
                            <span className="text-gray-900">
                              {[prospect.city, prospect.state].filter(Boolean).join(', ')}
                              {prospect.zipcode && ` ${prospect.zipcode}`}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-sm">
                          <IconCalendar size={14} className="text-gray-400" />
                          <span className="text-gray-900">
                            Last contacted: {prospect.last_contacted_date 
                              ? new Date(prospect.last_contacted_date).toLocaleDateString()
                              : 'Never'
                            }
                          </span>
                        </div>
                        {prospect.notes && (
                          <div className="flex items-start gap-2 text-sm">
                            <IconNotes size={14} className="text-gray-400 mt-0.5" />
                            <span className="text-gray-600">{prospect.notes}</span>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        <button
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors text-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingProspect(prospect);
                          }}
                        >
                          <IconEdit size={16} />
                          Edit
                        </button>
                        <button
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors text-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(prospect.id);
                          }}
                        >
                          <IconTrash size={16} />
                          Delete
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

      {/* Add/Edit Modal */}
      {(showAddModal || editingProspect) && (
        <ProspectModal 
          prospect={editingProspect}
          onClose={() => {
            setShowAddModal(false);
            setEditingProspect(null);
          }}
          onSave={fetchProspects}
        />
      )}

      {/* View Modal */}
      {viewingProspect && (
        <>
          {console.log('Rendering modal for:', viewingProspect.restaurant_name)}
          <ViewProspectModal 
            prospect={viewingProspect}
            onClose={() => setViewingProspect(null)}
            onEdit={() => {
              setEditingProspect(viewingProspect);
              setViewingProspect(null);
            }}
          />
        </>
      )}
    </AdminLayout>
  );
}

// Modal Component for Add/Edit
function ProspectModal({ prospect, onClose, onSave }) {
  const [formData, setFormData] = useState({
    restaurant_name: prospect?.restaurant_name || '',
    contact_name: prospect?.contact_name || '',
    phone_number: prospect?.phone_number || '',
    email: prospect?.email || '',
    street_address: prospect?.street_address || '',
    city: prospect?.city || '',
    state: prospect?.state || '',
    zipcode: prospect?.zipcode || '',
    last_contacted_date: prospect?.last_contacted_date || '',
    notes: prospect?.notes || ''
  });
  const [saving, setSaving] = useState(false);
  const [notContactedYet, setNotContactedYet] = useState(!prospect?.last_contacted_date);

  // Phone number formatting function
  const formatPhoneNumber = (value) => {
    // Remove all non-digits
    const digits = value.replace(/\D/g, '');
    
    // Limit to 10 digits
    const limitedDigits = digits.slice(0, 10);
    
    // Format based on length
    if (limitedDigits.length >= 6) {
      return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3, 6)}-${limitedDigits.slice(6)}`;
    } else if (limitedDigits.length >= 3) {
      return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3)}`;
    } else if (limitedDigits.length > 0) {
      return `(${limitedDigits}`;
    }
    return '';
  };

  const handlePhoneChange = (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    setFormData(prev => ({...prev, phone_number: formatted}));
  };

  const handleContactedCheckbox = (checked) => {
    setNotContactedYet(checked);
    if (checked) {
      setFormData(prev => ({...prev, last_contacted_date: ''}));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      // Prepare data for submission
      const submitData = {
        ...formData,
        last_contacted_date: notContactedYet ? null : formData.last_contacted_date || null
      };

      if (prospect) {
        // Update existing prospect
        const { error } = await supabase
          .from('prospective_clients')
          .update(submitData)
          .eq('id', prospect.id);

        if (error) throw error;

        // Log activity
        await logActivity({
          activityType: ACTIVITY_TYPES.PROSPECT_UPDATED,
          title: `Prospect "${submitData.restaurant_name}" updated`,
          subtitle: `Contact: ${submitData.contact_name || 'Not provided'} • ${submitData.city || 'Location not set'}`,
          details: `Updated prospect information including ${Object.keys(submitData).filter(key => submitData[key]).join(', ')}`,
          metadata: { prospect_id: prospect.id }
        });

        alert('Prospect updated successfully');
      } else {
        // Create new prospect
        const { data: newProspect, error } = await supabase
          .from('prospective_clients')
          .insert([submitData])
          .select()
          .single();

        if (error) throw error;

        // Log activity
        await logActivity({
          activityType: ACTIVITY_TYPES.PROSPECT_CREATED,
          title: `New prospect "${submitData.restaurant_name}" added`,
          subtitle: `Contact: ${submitData.contact_name || 'Not provided'} • ${submitData.phone_number || 'No phone'}`,
          details: `Added to prospective clients pipeline with ${submitData.notes ? 'notes' : 'no notes'}`,
          metadata: { prospect_id: newProspect.id }
        });

        alert('Prospect added successfully');
      }

      onSave();
      onClose();
    } catch (error) {
      console.error('Error saving prospect:', error);
      alert('Failed to save prospect: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {prospect ? 'Edit Prospect' : 'Add New Prospect'}
          </h2>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Restaurant Name *
              </label>
              <input
                type="text"
                required
                value={formData.restaurant_name}
                onChange={(e) => setFormData(prev => ({...prev, restaurant_name: e.target.value}))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Contact Name
              </label>
              <input
                type="text"
                value={formData.contact_name}
                onChange={(e) => setFormData(prev => ({...prev, contact_name: e.target.value}))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                value={formData.phone_number}
                onChange={handlePhoneChange}
                placeholder="(555) 123-4567"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({...prev, email: e.target.value}))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
              />
            </div>
          </div>
          
          {/* Address Section */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Address Information</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Street Address
                </label>
                <input
                  type="text"
                  value={formData.street_address}
                  onChange={(e) => setFormData(prev => ({...prev, street_address: e.target.value}))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
                  placeholder="123 Main Street"
                />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    City
                  </label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData(prev => ({...prev, city: e.target.value}))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
                    placeholder="New York"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    State
                  </label>
                  <input
                    type="text"
                    value={formData.state}
                    onChange={(e) => setFormData(prev => ({...prev, state: e.target.value}))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
                    placeholder="NY"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    ZIP Code
                  </label>
                  <input
                    type="text"
                    value={formData.zipcode}
                    onChange={(e) => setFormData(prev => ({...prev, zipcode: e.target.value}))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
                    placeholder="10001"
                  />
                </div>
              </div>
            </div>
          </div>
          
          {/* Contact Information */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Contact Information</h3>
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Last Contacted Date
                </label>
                <input
                  type="date"
                  value={formData.last_contacted_date}
                  onChange={(e) => {
                    setFormData(prev => ({...prev, last_contacted_date: e.target.value}));
                    if (e.target.value) {
                      setNotContactedYet(false);
                    }
                  }}
                  disabled={notContactedYet}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
              <div className="flex items-center mt-8">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notContactedYet}
                    onChange={(e) => handleContactedCheckbox(e.target.checked)}
                    className="w-4 h-4 text-[#ADD8E6] border-gray-300 rounded focus:ring-[#ADD8E6]"
                  />
                  <span className="text-sm font-medium text-gray-700">Haven't contacted yet</span>
                </label>
              </div>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes
            </label>
            <textarea
              rows={4}
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({...prev, notes: e.target.value}))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ADD8E6] focus:border-transparent"
              placeholder="Add any notes about this prospect..."
            />
          </div>
          
          <div className="flex items-center justify-end gap-4 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-gray-900 border-t-transparent rounded-full animate-spin"></div>
                  Saving...
                </>
              ) : (
                <>
                  <IconPlus size={18} />
                  {prospect ? 'Update Prospect' : 'Add Prospect'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// View-Only Modal Component
function ViewProspectModal({ prospect, onClose, onEdit }) {
  const needsFollowUp = !prospect.last_contacted_date || 
    new Date(prospect.last_contacted_date) < new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg">
                <IconBuilding size={24} className="text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{prospect.restaurant_name}</h2>
                <p className="text-gray-600">Prospective Client Details</p>
              </div>
            </div>
            {needsFollowUp && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-orange-100 text-orange-800">
                <IconClock size={16} className="mr-1" />
                Needs Follow-up
              </span>
            )}
          </div>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Contact Information */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
              <IconUsers size={20} className="text-gray-600" />
              Contact Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50 p-4 rounded-lg">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Contact Name</label>
                <p className="text-gray-900 font-medium">
                  {prospect.contact_name || <span className="text-gray-400 italic">Not provided</span>}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Phone Number</label>
                <div className="flex items-center gap-2">
                  <IconPhone size={16} className="text-gray-400" />
                  <p className="text-gray-900">
                    {prospect.phone_number || <span className="text-gray-400 italic">Not provided</span>}
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Email</label>
                <div className="flex items-center gap-2">
                  <IconMail size={16} className="text-gray-400" />
                  <p className="text-gray-900">
                    {prospect.email || <span className="text-gray-400 italic">Not provided</span>}
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Last Contacted</label>
                <div className="flex items-center gap-2">
                  <IconCalendar size={16} className="text-gray-400" />
                  <p className="text-gray-900">
                    {prospect.last_contacted_date 
                      ? new Date(prospect.last_contacted_date).toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })
                      : <span className="text-gray-400 italic">Never contacted</span>
                    }
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Address Information */}
          {(prospect.street_address || prospect.city || prospect.state || prospect.zipcode) && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
                <IconBuilding size={20} className="text-gray-600" />
                Address
              </h3>
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="text-gray-900">
                  {prospect.street_address && (
                    <p className="font-medium">{prospect.street_address}</p>
                  )}
                  {(prospect.city || prospect.state || prospect.zipcode) && (
                    <p>
                      {[prospect.city, prospect.state].filter(Boolean).join(', ')}
                      {prospect.zipcode && ` ${prospect.zipcode}`}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          {prospect.notes && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
                <IconNotes size={20} className="text-gray-600" />
                Notes
              </h3>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-900 whitespace-pre-wrap">{prospect.notes}</p>
              </div>
            </div>
          )}

          {/* Timeline Info */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
              <IconClock size={20} className="text-gray-600" />
              Timeline
            </h3>
            <div className="bg-gray-50 p-4 rounded-lg space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Added to system:</span>
                <span className="text-gray-900 font-medium">
                  {new Date(prospect.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
              {prospect.updated_at !== prospect.created_at && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Last updated:</span>
                  <span className="text-gray-900 font-medium">
                    {new Date(prospect.updated_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center justify-between gap-4 p-6 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-2 px-6 py-2 bg-[#ADD8E6] text-gray-900 rounded-lg hover:bg-[#9CC5D4] transition-colors font-medium"
          >
            <IconEdit size={18} />
            Edit Prospect
          </button>
        </div>
      </div>
    </div>
  );
}