import { todayISO } from './format';

/** Períodos rápidos das telas de custos, pagamentos e entregas feitas. */
export type Period = 'today' | 'week' | 'month' | 'lastMonth';

export const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: '7 dias' },
  { value: 'month', label: 'Mês' },
  { value: 'lastMonth', label: 'Mês passado' },
];

export function periodRange(p: Period): { date_from: string; date_to: string } {
  const today = todayISO();
  const monthStart = `${today.slice(0, 8)}01`;
  if (p === 'today') return { date_from: today, date_to: today };
  if (p === 'week') return { date_from: todayISO(-6), date_to: today };
  if (p === 'month') return { date_from: monthStart, date_to: today };
  const lastDay = new Date(`${monthStart}T12:00:00`);
  lastDay.setDate(0); // último dia do mês anterior
  const end = lastDay.toLocaleDateString('en-CA');
  return { date_from: `${end.slice(0, 8)}01`, date_to: end };
}
