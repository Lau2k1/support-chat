import axios from 'axios';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';

// SEC-01: the session travels in an HttpOnly cookie, so there is no token for
// JS to read or attach. Same-origin requests always send the cookie.
const api = axios.create({
  baseURL: '/',
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status;
    if (status === 401) {
      useAuthStore.getState().logout();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    } else if (status === 402) {
      // Billing gate: the tenant is unpaid. Surface a toast; the panel also shows
      // a persistent paywall banner and the billing section.
      useUIStore
        .getState()
        .showToast(error.response?.data?.error || 'Функции доступны после оплаты тарифа', 'warning');
    }
    return Promise.reject(error);
  }
);

export default api;
