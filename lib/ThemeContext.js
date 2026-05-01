// lib/ThemeContext.js
// Provides useTheme() hook to any component.
// Injects CSS custom properties onto <html> whenever the theme changes.
// Persists the user's preference in localStorage.
//
// Usage:
//   import { useTheme } from '../lib/ThemeContext';
//   const { theme, toggleTheme, isDark } = useTheme();

import React, { createContext, useContext, useEffect, useState } from 'react';
import { THEMES } from './theme';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'optimenu-theme';
const DEFAULT_THEME = 'dark';

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [mounted, setMounted] = useState(false);

  // On mount: read saved preference or system preference
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
      setTheme(saved);
    } else {
      // Respect OS preference if no saved choice
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(prefersDark ? 'dark' : 'light');
    }
    setMounted(true);
  }, []);

  // Inject CSS variables onto <html> whenever theme changes
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    const tokens = THEMES[theme];
    Object.entries(tokens).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    // Also set a data attribute so you can target [data-theme="light"] in CSS if needed
    root.setAttribute('data-theme', theme);
  }, [theme, mounted]);

  function toggleTheme() {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }

  function setThemeExplicit(t) {
    if (t !== 'dark' && t !== 'light') return;
    localStorage.setItem(STORAGE_KEY, t);
    setTheme(t);
  }

  return (
    <ThemeContext.Provider value={{
      theme,
      isDark: theme === 'dark',
      isLight: theme === 'light',
      toggleTheme,
      setTheme: setThemeExplicit,
    }}>
      {/* Prevent flash of wrong theme before mount */}
      {mounted ? children : <div style={{ visibility: 'hidden' }}>{children}</div>}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme() must be used inside <ThemeProvider>');
  return ctx;
}