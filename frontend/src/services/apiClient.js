// API Client - Axios instance configuration
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

function isLoginRequest(config) {
  const path = config?.url?.split('?')[0] ?? '';
  return (
    path.endsWith('/v1/auth/login') ||
    path.endsWith('/v1/auth/refresh') ||
    path.endsWith('/v1/auth/sso/exchange')
  );
}

let refreshPromise = null;

async function refreshAccessToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) {
    throw new Error('Missing refresh token');
  }

  refreshPromise = axios
    .post(`${API_BASE_URL}/v1/auth/refresh`, {
      refresh_token: refreshToken,
    })
    .then((res) => {
      const { access_token, refresh_token: newRefresh } = res.data.data;
      localStorage.setItem('access_token', access_token);
      localStorage.setItem('refresh_token', newRefresh);
      return access_token;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

// Request interceptor — attach Bearer token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token && !isLoginRequest(config)) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Attach queue token if present
    const queueToken = sessionStorage.getItem('queue_token');
    if (queueToken) {
      config.headers['X-Queue-Token'] = queueToken;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor — handle 401 token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and not already retried, try refreshing token
    if (error.response?.status === 401 && !isLoginRequest(originalRequest) && !originalRequest?._retry) {
      originalRequest._retry = true;

      if (localStorage.getItem('refresh_token')) {
        try {
          const accessToken = await refreshAccessToken();
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return apiClient(originalRequest);
        } catch {
          // Refresh failed — clear everything and redirect to login
          localStorage.clear();
          window.location.href = '/login';
          return Promise.reject(error);
        }
      }

      localStorage.clear();
      window.location.href = '/login';
    }

    return Promise.reject(error);
  },
);

export default apiClient;
