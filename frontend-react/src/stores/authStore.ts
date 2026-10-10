import { create } from 'zustand';
import type { JwtPayload } from '@/types';

function parseJwt(token: string): JwtPayload | null {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

interface AuthState {
  token: string | null;
  user: JwtPayload | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isSuperadmin: boolean;
  tenantId: number | null;
  login: (token: string) => void;
  logout: () => void;
  checkAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  const token = localStorage.getItem('token');
  const user = token ? parseJwt(token) : null;

  return {
    token,
    user,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin' || user?.role === 'superadmin',
    isSuperadmin: user?.role === 'superadmin',
    tenantId: user?.tid ?? null,

    login: (newToken: string) => {
      localStorage.setItem('token', newToken);
      const parsed = parseJwt(newToken);
      set({
        token: newToken,
        user: parsed,
        isAuthenticated: !!parsed,
        isAdmin: parsed?.role === 'admin' || parsed?.role === 'superadmin',
        isSuperadmin: parsed?.role === 'superadmin',
        tenantId: parsed?.tid ?? null,
      });
    },

    logout: () => {
      localStorage.removeItem('token');
      set({
        token: null,
        user: null,
        isAuthenticated: false,
        isAdmin: false,
        isSuperadmin: false,
        tenantId: null,
      });
    },

    checkAuth: () => {
      const t = localStorage.getItem('token');
      if (!t) {
        set({ token: null, user: null, isAuthenticated: false, isAdmin: false, isSuperadmin: false, tenantId: null });
        return;
      }
      const parsed = parseJwt(t);
      set({
        token: t,
        user: parsed,
        isAuthenticated: !!parsed,
        isAdmin: parsed?.role === 'admin' || parsed?.role === 'superadmin',
        isSuperadmin: parsed?.role === 'superadmin',
        tenantId: parsed?.tid ?? null,
      });
    },
  };
});