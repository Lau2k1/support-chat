import { createTheme } from '@mui/material/styles';

/**
 * Dual color schemes (light + dark) rendered through CSS variables
 * (cssVariables + colorSchemeSelector 'data-mui-color-scheme'), so the mode
 * switches without re-rendering Emotion styles: [data-mui-color-scheme="dark"]
 * on <html> flips every palette var. ThemeProvider (main.tsx) persists the
 * chosen mode to localStorage key 'sc_theme_mode'; the inline script in
 * index.html reads the same key before the bundle loads to avoid a light
 * flash in dark mode.
 *
 * Extra semantic tokens (ok/bad/warn/info) exist because several surfaces use
 * pastel chip pairs (bg + text) that must invert with the scheme — translucent
 * backgrounds alone can't fix text contrast on dark paper.
 */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data-mui-color-scheme' },
  colorSchemes: {
    light: {
      palette: {
        primary: {
          main: '#007bff',
          dark: '#0056b3',
          light: '#4d9eff',
        },
        background: {
          default: '#f5f7f9',
          paper: '#ffffff',
        },
        text: {
          primary: '#1e293b',
          secondary: '#64748b',
        },
        success: {
          main: '#4ade80',
        },
        warning: {
          main: '#f59e0b',
        },
        error: {
          main: '#ef4444',
        },
        info: {
          main: '#0284c7',
        },
        ok: '#16a34a',
        okBg: 'rgba(22, 163, 74, 0.14)',
        bad: '#dc2626',
        badBg: 'rgba(220, 38, 38, 0.13)',
        warn: '#a16207',
        warnBg: 'rgba(234, 179, 8, 0.16)',
        infoBg: 'rgba(2, 132, 199, 0.12)',
      },
    },
    dark: {
      palette: {
        primary: {
          main: '#4d9eff',
          dark: '#007bff',
          light: '#8cbdff',
          contrastText: '#0b1220',
        },
        background: {
          default: '#0f172a',
          paper: '#1e293b',
        },
        text: {
          primary: '#e2e8f0',
          secondary: '#94a3b8',
        },
        divider: '#334155',
        success: {
          main: '#4ade80',
        },
        warning: {
          main: '#fbbf24',
        },
        error: {
          main: '#f87171',
        },
        info: {
          main: '#38bdf8',
        },
        ok: '#4ade80',
        okBg: 'rgba(74, 222, 128, 0.14)',
        bad: '#f87171',
        badBg: 'rgba(248, 113, 113, 0.14)',
        warn: '#fbbf24',
        warnBg: 'rgba(251, 191, 36, 0.16)',
        infoBg: 'rgba(56, 189, 248, 0.13)',
      },
    },
  },
  typography: {
    fontFamily: 'Inter, sans-serif',
    h5: {
      fontWeight: 700,
    },
    h6: {
      fontWeight: 600,
    },
    subtitle2: {
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
  },
});
