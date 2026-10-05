import axios from 'axios';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';

/** Registros feitos sem sinal (entrega, abastecimento, despesa). Ficam guardados no celular (IndexedDB) e vão sozinhos
 *  quando o sinal volta. O id é o client_id que o servidor usa para não duplicar um reenvio. */
export interface OutboxItem {
  id: string;
  url: string;
  label: string;
  fields: Record<string, string>;
  files: { field: string; blob: Blob; filename: string }[];
  createdAt: string;
  /** o servidor recusou (não adianta reenviar): o motorista vê o motivo e descarta */
  error?: string;
}

const DB_NAME = 'frotagest';
const STORE = 'outbox';
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const listOutbox = () => tx<OutboxItem[]>('readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>);
const put = (item: OutboxItem) => tx('readwrite', (s) => s.put(item)).then(changed);
export const discard = (id: string) => tx('readwrite', (s) => s.delete(id)).then(changed);

/** Sem resposta do servidor (sem sinal, servidor fora): vale guardar e tentar de novo. */
export const isNetworkError = (e: unknown) => axios.isAxiosError(e) && !e.response;

export const newClientId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

async function send<T>(item: OutboxItem): Promise<T> {
  const form = new FormData();
  Object.entries(item.fields).forEach(([k, v]) => form.append(k, v));
  item.files.forEach((f) => form.append(f.field, f.blob, f.filename));
  form.append('client_id', item.id);
  form.append('recorded_at', item.createdAt);
  return (await api.post<T>(item.url, form)).data;
}

/** Envia na hora; sem sinal, guarda no celular para enviar depois. */
export async function submitOrQueue<T>(item: Omit<OutboxItem, 'createdAt' | 'id'> & { id?: string }) {
  const full: OutboxItem = { ...item, id: item.id ?? newClientId(), createdAt: new Date().toISOString() };
  try {
    return { data: await send<T>(full), queued: false as const };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await put(full);
    return { data: null, queued: true as const };
  }
}

let flushing = false;

/** Tenta enviar o que ficou guardado. Para no primeiro erro de rede (o sinal ainda não voltou). */
export async function flushOutbox(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of await listOutbox()) {
      if (item.error) continue;
      try {
        await send(item);
        await discard(item.id);
        sent += 1;
      } catch (e) {
        if (isNetworkError(e)) break;
        await put({ ...item, error: errorMessage(e) });
      }
    }
  } finally {
    flushing = false;
    changed();
  }
  return sent;
}

/** Itens guardados, para o aviso "aguardando envio". */
export function useOutbox() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => listOutbox().then((list) => alive && setItems(list)).catch(() => alive && setItems([]));
    load();
    listeners.add(load);
    return () => {
      alive = false;
      listeners.delete(load);
    };
  }, []);
  return items;
}

/** Envia sozinho quando o sinal volta, a cada 30 s e ao abrir o app. */
export function useOutboxSync(enabled: boolean, onSent?: (count: number) => void) {
  useEffect(() => {
    if (!enabled || typeof indexedDB === 'undefined') return;
    const run = () => flushOutbox().then((n) => n && onSent?.(n)).catch(() => undefined);
    run();
    window.addEventListener('online', run);
    const timer = window.setInterval(run, 30_000);
    return () => {
      window.removeEventListener('online', run);
      window.clearInterval(timer);
    };
  }, [enabled, onSent]);
}
