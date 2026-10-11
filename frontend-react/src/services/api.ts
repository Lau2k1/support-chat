import axios from 'axios';
import { useAuthStore } from '@/stores/authStore';

// SEC-01: the session travels in an HttpOnly cookie, so there is no token for
// JS to read or attach. Same-origin requests always send the cookie.
const api = axios.create({
  baseURL: '/',
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
