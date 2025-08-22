// components/AdminLayout.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import supabase from '../lib/supabaseClient';
import {
  IconDashboard,
  IconClock,
  IconFileText,
  IconTrendingUp,
  IconBook,
  IconSearch,
  IconUsers,
  IconUserPlus,
  IconSettings,
  IconHelp,
  IconMenu2,
  IconX,
  IconChevronLeft,
} from '@tabler/icons-react';

export default function AdminLayout({ children, pageTitle, pageDescription, pageIcon: PageIcon }) {
  const router = useRouter();
  // Initialize sidebar state from localStorage immediately, with fallback to false
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    // Always start with false on server-side to prevent hydration mismatch
    return false;
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Handle client-side initialization
  useEffect(() => {
    setIsClient(true);
    const savedState = localStorage.getItem('sidebarCollapsed');
    if (savedState !== null) {
      setSidebarCollapsed(JSON.parse(savedState));
    }
  }, []);

  // Save sidebar state to localStorage when it changes
  const toggleSidebar = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    if (typeof window !== 'undefined') {
      localStorage.setItem('sidebarCollapsed', JSON.stringify(newState));
    }
  };

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/admin/login');
  }

  const navigationData = {
    main: [
      {
        title: "Dashboard",
        icon: IconDashboard,
        href: "/admin",
        active: router.pathname === '/admin'
      },
      {
        title: "Pending Review",
        icon: IconClock,
        href: "/admin/pending-invoices",
        active: router.pathname === '/admin/pending-invoices'
      },
      {
        title: "Invoices",
        icon: IconFileText,
        href: "/admin/total-invoices",
        active: router.pathname === '/admin/total-invoices'
      },
      {
        title: "Analytics",
        icon: IconTrendingUp,
        href: "/admin/analytics",
        active: router.pathname === '/admin/analytics'
      },
      {
        title: "Ingredients",
        icon: IconBook,
        href: "/admin/ingredients",
        active: router.pathname === '/admin/ingredients'
      },
      {
        title: "Menu Items",
        icon: IconSearch,
        href: "/admin/menu-items",
        active: router.pathname === '/admin/menu-items'
      }
    ],
    resources: [
      
      {
        title: "Clients",
        icon: IconUsers,
        href: "/admin/clients",
        active: router.pathname === '/admin/clients'
      },
      {
        title: "Prospective Clients",
        icon: IconUserPlus,
        href: "/admin/prospective-clients",
        active: router.pathname === '/admin/prospective-clients'
      }
    ],
    secondary: [
      {
        title: "Settings",
        icon: IconSettings,
        href: "/admin/settings",
        active: router.pathname === '/admin/settings'
      },
      {
        title: "Help",
        icon: IconHelp,
        href: "/admin/help",
        active: router.pathname === '/admin/help'
      }
    ]
  };

  const NavItem = ({ item, collapsed = false }) => {
    const IconComponent = item.icon;
    
    return (
      <Link 
        href={item.href}
        className={`
          flex items-center gap-3 w-full px-3 py-2.5 rounded-lg transition-all duration-200
          ${item.active 
            ? 'bg-[#ADD8E6] text-gray-900 shadow-lg' 
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }
          ${collapsed ? 'justify-center' : ''}
        `}
      >
        <IconComponent size={20} className="flex-shrink-0" />
        {!collapsed && (
          <>
            <span className="font-medium">{item.title}</span>
            {item.badge && (
              <span className="ml-auto bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                {item.badge}
              </span>
            )}
          </>
        )}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="flex">
        {/* Sidebar */}
        <aside className={`
          flex flex-col bg-white border-r border-gray-200 transition-all duration-300
          ${sidebarCollapsed ? 'w-20' : 'w-72'}
          ${mobileMenuOpen ? 'fixed inset-y-0 left-0 z-50 translate-x-0' : 'fixed inset-y-0 left-0 z-50 -translate-x-full'}
          lg:fixed lg:inset-y-0 lg:left-0 lg:translate-x-0
        `}>
          {/* Sidebar Header */}
          <div className="flex items-center justify-between px-6 py-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              {!sidebarCollapsed ? (
                <div className="flex items-center">
                  <img 
                    src="/optimenu-logo.png" 
                    alt="OptiMenu Solutions" 
                    className="h-7 w-auto"
                  />
                </div>
              ) : (
                <button 
                  onClick={toggleSidebar}
                  className="flex items-center justify-center hover:opacity-80 transition-opacity"
                >
                  <img 
                    src="/optimenu-logo-collapsed.png" 
                    alt="OptiMenu" 
                    className="h-12 w-12 object-contain"
                  />
                </button>
              )}
            </div>
            {!sidebarCollapsed && (
              <button
                onClick={toggleSidebar}
                className="hidden lg:flex items-center justify-center w-8 h-8 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <IconChevronLeft size={16} className={`transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} />
              </button>
            )}
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden flex items-center justify-center w-8 h-8 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <IconX size={16} />
            </button>
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 px-4 py-6 overflow-y-auto">
            <nav className="space-y-8">
              {/* Main Navigation */}
              <div>
                {!sidebarCollapsed && (
                  <h3 className="px-3 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Main
                  </h3>
                )}
                <div className="space-y-1">
                  {navigationData.main.map((item, index) => (
                    <NavItem key={index} item={item} collapsed={sidebarCollapsed} />
                  ))}
                </div>
              </div>

              {/* Resources Navigation */}
              <div>
                {!sidebarCollapsed && (
                  <h3 className="px-3 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Resources
                  </h3>
                )}
                <div className="space-y-1">
                  {navigationData.resources.map((item, index) => (
                    <NavItem key={index} item={item} collapsed={sidebarCollapsed} />
                  ))}
                </div>
              </div>

              {/* Secondary Navigation */}
              <div className="pt-8 border-t border-gray-200">
                <div className="space-y-1">
                  {navigationData.secondary.map((item, index) => (
                    <NavItem key={index} item={item} collapsed={sidebarCollapsed} />
                  ))}
                </div>
              </div>
            </nav>
          </div>

          {/* Sidebar Footer */}
          <div className="p-4 border-t border-gray-200">
            <button 
              onClick={handleSignOut}
              className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center justify-center w-8 h-8 bg-[#ADD8E6] text-gray-900 rounded-full font-semibold">
                A
              </div>
              {!sidebarCollapsed && (
                <div className="flex flex-col items-start">
                  <span className="text-sm font-medium text-gray-900">Admin User</span>
                  <span className="text-xs text-gray-500">Administrator</span>
                </div>
              )}
            </button>
            {!sidebarCollapsed && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="text-center">
                  <div className="text-sm font-medium text-gray-900">OptiMenu<sup className="text-xs">©</sup></div>
                  <div className="text-xs text-gray-500">All Rights Reserved 2025</div>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Mobile overlay */}
        {mobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-25 z-40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Main Content */}
        <div className={`flex-1 min-h-screen transition-all duration-300 ${sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'}`}>
          {/* Header */}
          <header className="bg-white border-b border-gray-200 px-6 py-6 shadow-sm sticky top-0 z-10 flex items-center">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="lg:hidden flex items-center justify-center w-10 h-10 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <IconMenu2 size={20} />
                </button>
                <div className="flex items-center gap-3">
                  {PageIcon && (
                    <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-lg">
                      <PageIcon size={20} className="text-blue-600" />
                    </div>
                  )}
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">{pageTitle}</h1>
                    {pageDescription && <p className="text-lg text-gray-600 mt-1">{pageDescription}</p>}
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* Page Content */}
          <main>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}