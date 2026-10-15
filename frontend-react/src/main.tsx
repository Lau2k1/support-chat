import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from '@/theme';
import { router } from '@/router';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import ChangePasswordDialog from '@/components/common/ChangePasswordDialog';
import TelegramLinkDialog from '@/components/common/TelegramLinkDialog';
import CookieNotice from '@/components/common/CookieNotice';
import Toast from '@/components/common/Toast';
import { useAuthStore } from '@/stores/authStore';

// Probe the session cookie on boot so an expired session never leaves the app in
// a half-authenticated state (ProtectedRoute waits for `authReady`).
useAuthStore.getState().checkAuth();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme} modeStorageKey="sc_theme_mode" defaultMode="system">
      <CssBaseline />
      <RouterProvider router={router} />
      <ConfirmDialog />
      <ChangePasswordDialog />
      <TelegramLinkDialog />
      <CookieNotice />
      <Toast />
    </ThemeProvider>
  </React.StrictMode>
);
