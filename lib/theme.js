// lib/theme.js
// Single source of truth for all color tokens across OptiMenu.
// Each token has a dark and light value.
// These are injected as CSS custom properties on <html> by ThemeContext.

export const THEMES = {
  dark: {
    // ── Backgrounds ──────────────────────────────────────────────────────────
    '--bg-root':        '#0a0908',   // page background
    '--bg-surface':     '#13120f',   // cards, panels
    '--bg-elevated':    '#0f0e0c',   // topbar, nav
    '--bg-inset':       '#1a1915',   // pill rows, inset elements
    '--bg-input':       '#1a1915',   // text inputs

    // ── Borders ───────────────────────────────────────────────────────────────
    '--border':         '#2a2620',   // card borders, dividers
    '--border-subtle':  '#1a1915',   // inner borders, pill borders

    // ── Text ──────────────────────────────────────────────────────────────────
    '--text-primary':   '#e8e2d8',   // headings, values, main content
    '--text-secondary': '#9a9086',   // ingredient names, body text
    '--text-muted':     '#6b6358',   // labels, sub-labels
    '--text-faint':     '#3a3630',   // placeholders, section headers, footer text
    '--text-disabled':  '#2a2620',   // truly invisible — use sparingly

    // ── Accent ────────────────────────────────────────────────────────────────
    '--accent':         '#02a4ba',   // teal — primary brand color
    '--accent-bg':      'rgba(2,164,186,0.10)',
    '--accent-border':  'rgba(2,164,186,0.20)',

    // ── Semantic colors ───────────────────────────────────────────────────────
    '--color-green':    '#2a8a5a',
    '--color-amber':    '#d4a020',
    '--color-red':      '#c04040',
    '--color-red-bg':   'rgba(192,64,64,0.10)',

    // ── Ticket / thermal ──────────────────────────────────────────────────────
    '--ticket-bg':      '#111009',
    '--ticket-border':  '#2a2620',

    // ── Score ring track ──────────────────────────────────────────────────────
    '--ring-track':     '#1a1915',

    // ── Scrollbar ─────────────────────────────────────────────────────────────
    '--scrollbar-track':'#0f0e0c',
    '--scrollbar-thumb':'#2a2620',

    // ── Shadow ────────────────────────────────────────────────────────────────
    '--shadow':         'none',
  },

  light: {
    // ── Backgrounds ──────────────────────────────────────────────────────────
    '--bg-root':        '#f2efe9',
    '--bg-surface':     '#ffffff',
    '--bg-elevated':    '#f7f5f1',
    '--bg-inset':       '#eeebe4',
    '--bg-input':       '#f7f5f1',

    // ── Borders ───────────────────────────────────────────────────────────────
    '--border':         '#d8d3ca',
    '--border-subtle':  '#e8e4dc',

    // ── Text ──────────────────────────────────────────────────────────────────
    '--text-primary':   '#1a1612',
    '--text-secondary': '#4a453e',
    '--text-muted':     '#6b6358',
    '--text-faint':     '#9a9086',
    '--text-disabled':  '#c4bdb4',

    // ── Accent ────────────────────────────────────────────────────────────────
    '--accent':         '#0190a4',
    '--accent-bg':      'rgba(1,144,164,0.10)',
    '--accent-border':  'rgba(1,144,164,0.25)',

    // ── Semantic colors ───────────────────────────────────────────────────────
    '--color-green':    '#1e7a4a',
    '--color-amber':    '#b8860e',
    '--color-red':      '#b03030',
    '--color-red-bg':   'rgba(176,48,48,0.08)',

    // ── Ticket / thermal ──────────────────────────────────────────────────────
    '--ticket-bg':      '#fafaf8',
    '--ticket-border':  '#d8d3ca',

    // ── Score ring track ──────────────────────────────────────────────────────
    '--ring-track':     '#e8e4dc',

    // ── Scrollbar ─────────────────────────────────────────────────────────────
    '--scrollbar-track':'#f0ede6',
    '--scrollbar-thumb':'#d0cbc2',

    // ── Shadow ────────────────────────────────────────────────────────────────
    '--shadow':         '0 1px 4px rgba(0,0,0,0.08)',
  },
};

// Convenience: the full list of token names (useful for validation)
export const TOKEN_NAMES = Object.keys(THEMES.dark);