import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import ClientLayout from "../../components/ClientLayout";
import supabase from "../../lib/supabaseClient";
import {
  IconUser,
  IconMail,
  IconPhone,
  IconMapPin,
  IconBuilding,
  IconEdit,
  IconSave,
  IconX,
  IconCamera,
  IconSettings,
  IconBell,
  IconShield,
  IconLogout,
  IconAlertTriangle,
  IconCalendar
} from "@tabler/icons-react";

export default function Profile() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing, setEditing] = useState(false);
  
  // User data
  const [profile, setProfile] = useState({
    full_name: "",
    email: "",
    phone: "",
    restaurant_name: "",
    restaurant_address: "",
    restaurant_id: "",
    created_at: "",
    avatar_url: ""
  });
  
  // Form data for editing
  const [formData, setFormData] = useState({});

  useEffect(() => {
    fetchProfile();
  }, []);

  async function fetchProfile() {
    try {
        setLoading(true);
        setError("");

        const { data: { user }, error: userError } = await supabase.auth.getUser();
        
        if (userError || !user) {
        setError("Authentication required");
        router.push('/auth/login');
        return;
        }

        // Fetch profile data from your profiles table
        const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

        if (profileError) {
        setError("Failed to fetch profile: " + profileError.message);
        return;
        }

        const profileInfo = {
        full_name: profileData.full_name || "",
        email: profileData.email || user.email || "",
        phone: profileData.phone || "",
        restaurant_name: profileData.restaurant_name || "",
        restaurant_address: profileData.restaurant_address || "",
        restaurant_id: profileData.restaurant_id || "",
        role: profileData.role || "",
        created_at: profileData.created_at || "",
        avatar_url: ""
        };

        setProfile(profileInfo);
        setFormData(profileInfo);

    } catch (err) {
        setError("An unexpected error occurred");
    } finally {
        setLoading(false);
    }
    }

  async function handleSave() {
    try {
        setSaving(true);
        setError("");
        setSuccess("");

        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
        setError("Authentication required");
        return;
        }

        // Update profile in your profiles table
        const { error: profileError } = await supabase
        .from("profiles")
        .update({
            full_name: formData.full_name,
            restaurant_name: formData.restaurant_name,
            restaurant_address: formData.restaurant_address,
            phone: formData.phone
        })
        .eq("id", user.id);

        if (profileError) {
        setError("Failed to update profile: " + profileError.message);
        return;
        }

        setProfile(formData);
        setEditing(false);
        setSuccess("Profile updated successfully!");

    } catch (err) {
        setError("An unexpected error occurred");
    } finally {
        setSaving(false);
    }
    }

  function handleCancel() {
    setFormData(profile);
    setEditing(false);
    setError("");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/auth/login');
  }

  function getUserInitials(name) {
    if (!name) return "U";
    return name.split(' ')
      .map(part => part.charAt(0))
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Loading Profile</h3>
          <p className="text-gray-600">Fetching your information...</p>
        </div>
      </div>
    );
  }

  return (
    <ClientLayout 
      pageTitle="Profile" 
      pageDescription="Manage your account settings"
      pageIcon={IconUser}
    >
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Profile Settings</h1>
          <p className="text-gray-600">Manage your account information and preferences</p>
        </div>

        {/* Alert Messages */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6 rounded-r-lg">
            <div className="flex items-start">
              <IconAlertTriangle size={20} className="text-red-400 mt-0.5" />
              <div className="ml-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-6 rounded-r-lg">
            <div className="flex items-start">
              <IconSave size={20} className="text-green-400 mt-0.5" />
              <div className="ml-3">
                <p className="text-sm text-green-700">{success}</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Profile Card */}
          <div className="lg:col-span-1">
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="text-center">
                {/* Avatar */}
                <div className="relative inline-block mb-4">
                  <div className="w-24 h-24 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold">
                    {getUserInitials(profile.full_name)}
                  </div>
                  <button className="absolute bottom-0 right-0 w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center border-2 border-white transition-colors">
                    <IconCamera size={16} className="text-gray-600" />
                  </button>
                </div>

                <h2 className="text-xl font-bold text-gray-900 mb-1">
                  {profile.full_name || "Unknown User"}
                </h2>
                <p className="text-gray-600 mb-4">{profile.email}</p>

                {/* Quick Actions */}
                <div className="space-y-2">
                  <button
                    onClick={() => setEditing(!editing)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <IconEdit size={16} />
                    {editing ? "Cancel Edit" : "Edit Profile"}
                  </button>
                  
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <IconLogout size={16} />
                    Sign Out
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Profile Information */}
          <div className="lg:col-span-2 space-y-6">
            {/* Personal Information */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <IconUser size={16} className="text-blue-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Personal Information</h3>
                </div>
                {editing && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleCancel}
                      className="flex items-center gap-1 px-3 py-1 text-sm text-gray-600 hover:text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <IconX size={14} />
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      <IconSave size={14} />
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name
                  </label>
                  {editing ? (
                    <input
                      type="text"
                      value={formData.full_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  ) : (
                    <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                      <IconUser size={16} className="text-gray-400" />
                      <span className="text-gray-900">{profile.full_name || "Not provided"}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                    <IconMail size={16} className="text-gray-400" />
                    <span className="text-gray-900">{profile.email}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Email cannot be changed here</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number
                  </label>
                  {editing ? (
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="(555) 123-4567"
                    />
                  ) : (
                    <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                      <IconPhone size={16} className="text-gray-400" />
                      <span className="text-gray-900">{profile.phone || "Not provided"}</span>
                    </div>
                  )}
                </div>
                {/* Add this after the phone number field in the personal information section */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Role
                    </label>
                    <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                        <IconShield size={16} className="text-gray-400" />
                        <span className="text-gray-900 capitalize">{profile.role || "Not assigned"}</span>
                    </div>
                </div>

                <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Member Since
                    </label>
                <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                    <IconCalendar size={16} className="text-gray-400" />
                    <span className="text-gray-900">
                    {profile.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    }) : "Unknown"}
                    </span>
                </div>
                </div>
              </div>
            </div>

            {/* Restaurant Information */}
            {profile.restaurant_name && (
              <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                    <IconBuilding size={16} className="text-green-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Restaurant Information</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Restaurant Name
                    </label>
                    {editing ? (
                      <input
                        type="text"
                        value={formData.restaurant_name}
                        onChange={(e) => setFormData(prev => ({ ...prev, restaurant_name: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    ) : (
                      <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                        <IconBuilding size={16} className="text-gray-400" />
                        <span className="text-gray-900">{profile.restaurant_name}</span>
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Address
                    </label>
                    {editing ? (
                      <textarea
                        value={formData.restaurant_address}
                        onChange={(e) => setFormData(prev => ({ ...prev, restaurant_address: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Restaurant address..."
                      />
                    ) : (
                      <div className="flex items-start gap-2 p-3 bg-gray-50 rounded-lg">
                        <IconMapPin size={16} className="text-gray-400 mt-0.5" />
                        <span className="text-gray-900">{profile.restaurant_address || "Not provided"}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </ClientLayout>
  );
}