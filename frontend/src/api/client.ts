import axios, { AxiosError } from 'axios';

const TOKEN_KEY = 'frotagest.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    if (error.response?.status === 401 && tokenStore.get()) {
      tokenStore.clear();
      window.location.assign('/login');
    }
    return Promise.reject(error);
  },
);

/** Mensagem legível a partir do erro da API (o backend devolve `detail` em português). */
export function errorMessage(error: unknown, fallback = 'Não foi possível concluir. Tente de novo.'): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string') return detail;
    if (!error.response) return 'Sem conexão com o servidor. Verifique se o backend está rodando.';
  }
  return fallback;
}

export function chatSocketUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api/chat/ws?token=${encodeURIComponent(tokenStore.get() ?? '')}`;
}
