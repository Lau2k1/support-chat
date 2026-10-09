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
    isAdmin: user?.role === 'admin',

    login: (newToken: string) => {
      localStorage.setItem('token', newToken);
      const parsed = parseJwt(newToken);
      set({
        token: newToken,
        user: parsed,
        isAuthenticated: !!parsed,
        isAdmin: parsed?.role === 'admin',
      });
    },

    logout: () => {
      localStorage.removeItem('token');
      set({ token: null, user: null, isAuthenticated: false, isAdmin: false });
    },

    checkAuth: () => {
      const t = localStorage.getItem('token');
      if (!t) {
        set({ token: null, user: null, isAuthenticated: false, isAdmin: false });
        return;
      }
      const parsed = parseJwt(t);
      if (!parsed) {
        localStorage.removeItem('token');
        set({ token: null, user: null, isAuthenticated: false, isAdmin: false });
        return;
      }
      if (parsed.exp && parsed.exp * 1000 < Date.now()) {
        localStorage.removeItem('token');
        set({ token: null, user: null, isAuthenticated: false, isAdmin: false });
        return;
      }
      set({ token: t, user: parsed, isAuthenticated: true, isAdmin: parsed.role === 'admin' });
    },
  };
});
