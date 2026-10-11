import { create } from 'zustand';

/** Shape returned by GET /me (the JWT itself lives in an HttpOnly cookie). */
export interface CurrentUser {
  id: number;
  name: string;
  role: 'superadmin' | 'admin' | 'operator';
  tenantId: number | null;
}

interface AuthState {
  user: CurrentUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isSuperadmin: boolean;
  tenantId: number | null;
  /** True once the initial /me probe finished (prevents a /login bounce on reload). */
  authReady: boolean;
  /** Re-reads the session from the cookie after a successful login/register. */
  login: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

function derive(user: CurrentUser | null) {
  return {
    user,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin' || user?.role === 'superadmin',
    isSuperadmin: user?.role === 'superadmin',
    tenantId: user?.tenantId ?? null,
  };
}

async function fetchMe(): Promise<CurrentUser | null> {
  try {
    const res = await fetch('/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as CurrentUser;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  isSuperadmin: false,
  tenantId: null,
  authReady: false,

  // Called right after a successful /login or /register (cookie already set by the API).
  login: async () => {
    const user = await fetchMe();
    set({ ...derive(user), authReady: true });
  },

  logout: async () => {
    // Clear local state first so the UI redirects immediately, then drop the cookie.
    set({ ...derive(null), authReady: true });
    try {
      await fetch('/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      /* ignore network errors while logging out */
    }
  },

  checkAuth: async () => {
    const user = await fetchMe();
    set({ ...derive(user), authReady: true });
  },
}));
