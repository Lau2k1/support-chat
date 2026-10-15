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
      // Payment required, for two reasons: the tenant's subscription is unpaid
      // (PAYMENT_REQUIRED), or the call touches a feature its plan does not
      // include (PLAN_UPGRADE_REQUIRED, e.g. tickets below «Профи»). Either way
      // the server's own message is the clearest thing to show.
      useUIStore
        .getState()
        .showToast(error.response?.data?.error || 'Функции доступны после оплаты тарифа', 'warning');
    }
    return Promise.reject(error);
  }
);

export default api;
