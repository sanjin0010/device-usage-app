const TOKEN_KEY = 'device_app_token';
const BASE_KEY = 'device_server_base';

export function getServerBase() {
  const saved = localStorage.getItem(BASE_KEY);
  return saved ? saved.replace(/\/+$/, '') : '';
}

export function setServerBase(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (clean) {
    localStorage.setItem(BASE_KEY, clean);
  } else {
    localStorage.removeItem(BASE_KEY);
  }
}

function resolve(path) {
  const base = getServerBase();
  return base ? `${base}${path}` : path;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !String(path).includes('/api/auth/')) {
      clearToken();
      window.location.hash = '#/login';
    }
    throw new ApiError(data.error || '请求失败，请稍后重试', res.status);
  }
  return data;
}

export const api = {
  register: (payload) => request(resolve('/api/auth/register'), { method: 'POST', body: payload }),
  login: (payload) => request(resolve('/api/auth/login'), { method: 'POST', body: payload }),
  logout: () => request(resolve('/api/auth/logout'), { method: 'POST' }),
  me: () => request(resolve('/api/auth/me')),
  devices: (search = '') => request(resolve(`/api/devices${search ? `?search=${encodeURIComponent(search)}` : ''}`)),
  device: (id) => request(resolve(`/api/devices/${encodeURIComponent(id)}`)),
  createDevice: (payload) => request(resolve('/api/devices'), { method: 'POST', body: payload }),
  updateDevice: (id, payload) => request(resolve(`/api/devices/${encodeURIComponent(id)}`), { method: 'PUT', body: payload }),
  deleteDevice: (id) => request(resolve(`/api/devices/${encodeURIComponent(id)}`), { method: 'DELETE' }),
  startUse: (id, payload) => request(resolve(`/api/devices/${encodeURIComponent(id)}/start-use`), { method: 'POST', body: payload }),
  endUse: (id) => request(resolve(`/api/usage/${encodeURIComponent(id)}/end`), { method: 'POST' }),
  myUsage: () => request(resolve('/api/me/usage')),
};
