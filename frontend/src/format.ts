import type { Role } from './api/types';

const tz = 'America/Sao_Paulo';

export const fmtKm = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;

export const fmtDuration = (minutes: number) => `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });

export const fmtKg = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`;

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const fmtBRL = (n: number, digits = 2) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digits, maximumFractionDigits: digits });

/** AAAA-MM-DD → dd/mm/aaaa */
export const fmtDate = (isoDate: string) => new Date(`${isoDate}T12:00:00`).toLocaleDateString('pt-BR');

export const fmtDay = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });

/** Formata o CPF enquanto é digitado: 000.000.000-00. */
export const fmtCpf = (value: string) =>
  value
    .replace(/\D/g, '')
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');

export const onlyDigits = (value: string) => value.replace(/\D/g, '');

/** Formata o telefone enquanto é digitado: (31) 98888-7777 ou (31) 3333-4444. */
export const fmtPhone = (value: string) => {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d && `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

export const roleLabel: Record<Role, string> = { admin: 'Gestor', driver: 'Motorista' };

/** Para buscas: ignora acentos e maiúsculas ("joao" encontra "João"). */
export const searchKey = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Dia (AAAA-MM-DD, fuso de Brasília) de um instante ISO. */
export const localDateISO = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });

/** Horário na lista de conversas: hora se for hoje, "Ontem" ou dd/mm. */
export const fmtChatTime = (iso: string) => {
  const day = localDateISO(iso);
  if (day === todayISO()) return fmtTime(iso);
  if (day === todayISO(-1)) return 'Ontem';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: tz });
};

/** Separador de dia dentro da conversa. */
export const fmtDaySeparator = (iso: string) => {
  const day = localDateISO(iso);
  if (day === todayISO()) return 'Hoje';
  if (day === todayISO(-1)) return 'Ontem';
  return new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: tz });
};

/** "hoje", "amanhã" ou dd/mm/aaaa, para um dia AAAA-MM-DD. */
export const fmtDayRelative = (isoDate: string) => {
  if (isoDate === todayISO()) return 'hoje';
  if (isoDate === todayISO(1)) return 'amanhã';
  return fmtDate(isoDate);
};

/** Data de hoje (fuso de Brasília) no formato AAAA-MM-DD, usado nos filtros. */
export const todayISO = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: tz });
};
