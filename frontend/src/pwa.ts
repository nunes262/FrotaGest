import { useCallback, useEffect, useState } from 'react';
import { api } from './api/client';

/** Pedido de instalação do navegador (Chrome/Android): guardado para o botão "Instalar o app". */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    changed();
  });
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }
}

const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const update = () => force((n) => n + 1);
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return {
    installed: standalone(),
    canInstall: Boolean(installPrompt),
    /** No iPhone não há o pedido do navegador: é pelo "Compartilhar → Adicionar à Tela de Início" */
    showIosHint: isIos && !standalone(),
    install: async () => {
      if (!installPrompt) return;
      await installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      changed();
    },
  };
}

function base64ToBytes(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Notificações com o app fechado (Web Push): ativar neste aparelho. */
export function usePush() {
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    pushSupported() ? Notification.permission : 'unsupported',
  );

  useEffect(() => {
    if (!pushSupported()) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => setSubscribed(false));
  }, []);

  const enable = useCallback(async () => {
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== 'granted') throw new Error('Permita as notificações no navegador para receber os avisos.');
    const reg = await navigator.serviceWorker.ready;
    const { key } = (await api.get<{ key: string }>('/push/public-key')).data;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(key) }));
    await api.post('/push/subscriptions', sub.toJSON());
    setSubscribed(true);
  }, []);

  const disable = useCallback(async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.post('/push/subscriptions/remove', { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    setSubscribed(false);
  }, []);

  return { supported: pushSupported(), permission, subscribed, enable, disable };
}
