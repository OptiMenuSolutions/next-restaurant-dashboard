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
  IconLogout,
} from '@tabler/icons-react';

const geometricBackgroundStyle = {
  backgroundColor: '#f9fafb',
  backgroundImage: `
    radial-gradient(circle at 5px 5px, rgba(0, 0, 0, 0.04) 2px, transparent 2px),
    radial-gradient(circle at 15px 15px, rgba(0, 0, 0, 0.025) 1px, transparent 1px)
  `,
  backgroundSize: '20px 20px, 10px 10px',
  backgroundPosition: '0 0, 5px 5px',
  minHeight: '100vh'
};

export default function AdminLayout({ children, pageTitle, pageDescription, pageIcon: PageIcon }) {
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [userProfile, setUserProfile] = useState(null);

  useEffect(() => {
    fetchUserProfile();
  }, []);

  async function fetchUserProfile() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) return;

      // For admin, we might not have a profiles table entry, so we'll use basic user info
      setUserProfile({ 
        full_name: user.email?.split('@')[0] || 'Admin',
        email: user.email 
      });
    } catch (err) {
      console.error("Error fetching user profile:", err);
    }
  }

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
        title: "All Invoices",
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
      },
      {
        title: "Clients",
        icon: IconUsers,
        href: "/admin/clients",
        active: router.pathname === '/admin/clients'
      },
      {
        title: "Prospects",
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

  const NavItem = ({ item, index }) => {
    const IconComponent = item.icon;
    const isHovered = hoveredItem === `main-${index}`;
    
    return (
      <div className="relative">
        <Link 
          href={item.href}
          className={`
            flex items-center justify-center rounded-full transition-all duration-300 relative z-10
            ${item.active 
              ? 'text-white shadow-lg' 
              : 'text-gray-100 hover:text-gray-700 hover:bg-white hover:shadow-md'
            }
          `}
          style={{
            width: 'clamp(24px, 5vh, 56px)',
            height: 'clamp(24px, 5vh, 56px)',
            ...(item.active ? {
              backgroundColor: '#02a4ba',
              boxShadow: '0 10px 15px -3px rgba(2, 164, 186, 0.25), 0 4px 6px -2px rgba(2, 164, 186, 0.05)'
            } : {})
          }}
          onMouseEnter={() => setHoveredItem(`main-${index}`)}
          onMouseLeave={() => setHoveredItem(null)}
        >
          <IconComponent style={{ width: 'clamp(12px, 3vh, 24px)', height: 'clamp(12px, 3vh, 24px)' }} />
        </Link>
        
        {/* Hover Label */}
        {isHovered && (
          <div className="absolute left-16 top-1/2 -translate-y-1/2 z-50 pointer-events-none">
            <div className="bg-gray-900 text-white px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap shadow-lg">
              {item.title}
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 bg-gray-900 rotate-45"></div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const SecondaryNavItem = ({ item, index, isLogout = false }) => {
    const IconComponent = item.icon;
    
    const handleClick = (e) => {
      if (isLogout) {
        e.preventDefault();
        handleSignOut();
      } else {
        router.push(item.href);
      }
    };
    
    return (
      <button
        onClick={handleClick}
        className={`
          flex items-center justify-center rounded-full transition-all duration-300 relative z-10
          ${item.active 
            ? 'text-white shadow-lg' 
            : 'text-gray-500 hover:text-gray-700 hover:bg-white hover:shadow-md'
          }
        `}
        style={{
          width: 'clamp(24px, 5vh, 56px)',
          height: 'clamp(24px, 5vh, 56px)',
          ...(item.active ? {
            backgroundColor: '#02a4ba',
            boxShadow: '0 10px 15px -3px rgba(2, 164, 186, 0.25), 0 4px 6px -2px rgba(2, 164, 186, 0.05)'
          } : {})
        }}
      >
        <IconComponent style={{ width: 'clamp(12px, 3vh, 24px)', height: 'clamp(12px, 3vh, 24px)' }} />
      </button>
    );
  };

  const getUserInitials = () => {
    if (userProfile?.full_name) {
      return userProfile.full_name
        .split(' ')
        .map(name => name.charAt(0))
        .slice(0, 2)
        .join('')
        .toUpperCase();
    }
    return 'AD';
  };

  return (
    <div style={geometricBackgroundStyle}>
      <div className="flex">
        {/* Sidebar */}
        <aside 
          className={`
            fixed left-0 top-0 h-full bg-gray-700/95 backdrop-blur-sm z-40 flex flex-col items-center
            ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
            lg:translate-x-0
          `}
          style={{ width: 'clamp(60px, 8vh, 100px)' }}
        >
          {/* Logo */}
          <div 
            className="flex items-center justify-center mt-4"
            style={{ 
              width: 'clamp(48px, 6vh, 80px)', 
              height: 'clamp(48px, 6vh, 100px)' 
            }}
          >
            <img 
              src="/optimenu-logo-collapsed.png" 
              alt="OptiMenu" 
              className="object-contain"
              style={{ 
                width: 'clamp(16px, 6vh, 48px)', 
                height: 'clamp(16px, 6vh, 48px)' 
              }}
            />
          </div>

          {/* Main Navigation - Centered */}
          <div className="flex-1 flex flex-col items-center justify-center">
            <div 
              className="flex flex-col items-center py-4"
              style={{ gap: 'clamp(8px, 2vh, 24px)' }}
            >
              {navigationData.main.map((item, index) => (
                <NavItem key={index} item={item} index={index} />
              ))}
            </div>
          </div>

          {/* Secondary Navigation - Bottom */}
          <div 
            className="flex flex-col items-center pb-4"
            style={{ gap: 'clamp(8px, 1.5vh, 24px)' }}
          >
            {navigationData.secondary.map((item, index) => (
              <SecondaryNavItem key={index} item={item} index={index} />
            ))}
            
            {/* Logout Button */}
            <SecondaryNavItem 
              item={{ 
                title: "Log Out", 
                icon: IconLogout, 
                href: "/logout", 
                active: false 
              }} 
              index="logout" 
              isLogout={true}
            />
          </div>
        </aside>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="lg:hidden fixed top-6 left-6 z-50 flex items-center justify-center w-12 h-12 bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-xl shadow-lg transition-colors"
        >
          <IconMenu2 size={22} />
        </button>

        {/* Mobile Close Button */}
        {mobileMenuOpen && (
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden fixed top-6 left-6 z-50 flex items-center justify-center w-12 h-12 bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-xl shadow-lg transition-colors"
          >
            <IconX size={22} />
          </button>
        )}

        {/* Mobile overlay */}
        {mobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-25 z-30 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Main Content */}
        <div 
          className="flex-1" 
          style={{ paddingLeft: 'clamp(60px, 8vh, 100px)' }}
        >
          {/* Page Header - Always show with search bar */}
          <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm sticky top-0 z-10">
            <div 
              className="flex flex-col xl:flex-row xl:items-center justify-between gap-3"
              style={{ 
                padding: 'clamp(16px, 2vh, 24px) clamp(16px, 2vh, 32px)' 
              }}
            >
              {/* Left side - Page title */}
              <div className="flex items-center gap-4">
                {PageIcon && (
                  <div className="flex items-center justify-center w-10 h-10 bg-blue-100/80 rounded-lg">
                    <PageIcon size={20} className="text-blue-600" />
                  </div>
                )}
                <div>
                  {pageTitle ? (
                    <>
                      <h1 className="text-2xl font-bold text-gray-900">{pageTitle}</h1>
                      {pageDescription && <p className="text-gray-600 mt-1">{pageDescription}</p>}
                    </>
                  ) : (
                    <h1 className="text-xl font-bold text-gray-900">Admin Dashboard</h1>
                  )}
                </div>
              </div>

              {/* Right side - Search bar and profile */}
              <div className="flex items-center gap-3">
                <div className="w-full xl:w-80">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <IconSearch size={16} className="text-gray-400" />
                    </div>
                    <input
                      type="text"
                      placeholder="Search clients, invoices, analytics..."
                      className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white/90 backdrop-blur-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full font-semibold text-xs cursor-pointer hover:bg-blue-700 transition-colors flex-shrink-0">
                  {getUserInitials()}
                </div>
              </div>
            </div>
          </header>

          {/* Page Content */}
          <main 
            style={{ 
              padding: pageTitle ? 'clamp(16px, 2vh, 32px) clamp(16px, 2vh, 48px)' : 'clamp(16px, 2vh, 48px)' 
            }}
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}