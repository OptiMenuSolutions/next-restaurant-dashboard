// components/ClientLayout.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import supabase from '../lib/supabaseClient';
import {
  IconDashboard,
  IconFileText,
  IconChartBar,
  IconTrendingUp,
  IconClipboardList,
  IconChefHat,
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

export default function ClientLayout({ children, pageTitle, pageDescription, pageIcon: PageIcon }) {
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

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (!error && data) {
        setUserProfile(data);
      }
    } catch (err) {
      console.error("Error fetching user profile:", err);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/client/login');
  }

  const navigationData = {
    main: [
      {
        title: "Dashboard",
        icon: IconDashboard,
        href: "/client/dashboard",
        active: router.pathname === '/client/dashboard'
      },
      {
        title: "Invoices",
        icon: IconFileText,
        href: "/client/invoices",
        active: router.pathname === '/client/invoices' || router.pathname.startsWith('/client/invoices/')
      },
      {
        title: "Ingredients",
        icon: IconClipboardList,
        href: "/client/ingredients",
        active: router.pathname === '/client/ingredients' || router.pathname.startsWith('/client/ingredients/')
      },
      {
        title: "Menu Items",
        icon: IconChefHat,
        href: "/client/menu-items",
        active: router.pathname === '/client/menu-items' || router.pathname.startsWith('/client/menu-items/')
      },
      {
        title: "Analytics",
        icon: IconTrendingUp,
        href: "/client/analytics",
        active: router.pathname === '/client/analytics'
      }
    ],
    secondary: [
      {
        title: "Settings",
        icon: IconSettings,
        href: "/client/settings",
        active: router.pathname === '/client/settings'
      },
      {
        title: "Help",
        icon: IconHelp,
        href: "/client/help",
        active: router.pathname === '/client/help'
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
    return 'CL';
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
              style={{ gap: 'clamp(8px, 3.5vh, 32px)' }}
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
          {/* Page Content */}
          <main 
            className="lg:px-12" 
            style={{ 
              padding: 'clamp(16px, 2vh, 32px) clamp(16px, 2vh, 48px)' 
            }}
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}