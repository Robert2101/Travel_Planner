import { create } from 'zustand';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const useAuthStore = create((set, get) => ({
  user: null,
  token: localStorage.getItem('token') || null,
  isAuthenticated: !!localStorage.getItem('token'),
  loading: false,
  error: null,

  setToken: (token) => {
    if (token) {
      localStorage.setItem('token', token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      localStorage.removeItem('token');
      delete axios.defaults.headers.common['Authorization'];
    }
    set({ token, isAuthenticated: !!token });
  },

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const formData = new FormData();
      formData.append('username', username);
      formData.append('password', password);
      
      const res = await axios.post(`${API_BASE}/api/auth/login`, formData);
      get().setToken(res.data.access_token);
      await get().fetchMe();
      set({ loading: false });
      return true;
    } catch (err) {
      set({ error: err.response?.data?.detail || 'Login failed', loading: false });
      return false;
    }
  },

  register: async (username, email, password) => {
    set({ loading: true, error: null });
    try {
      const res = await axios.post(`${API_BASE}/api/auth/register`, { username, email, password });
      get().setToken(res.data.access_token);
      await get().fetchMe();
      set({ loading: false });
      return true;
    } catch (err) {
      set({ error: err.response?.data?.detail || 'Registration failed', loading: false });
      return false;
    }
  },

  logout: () => {
    get().setToken(null);
    set({ user: null, isAuthenticated: false });
  },

  fetchMe: async () => {
    const { token } = get();
    if (!token) return;
    
    try {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      const res = await axios.get(`${API_BASE}/api/auth/me`);
      set({ user: res.data, isAuthenticated: true });
    } catch (err) {
      get().logout();
    }
  },

  init: async () => {
    const { token } = get();
    if (token) {
      await get().fetchMe();
    }
  }
}));
