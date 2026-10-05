import { useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useDeliveries, useDeliveriesBetween, useRegionEstimates, useRunHistory, useStartRun, useVehicles } from '../api/queries';
import type { Delivery } from '../api/types';
import { fmtBRL, fmtDay, fmtKg, fmtTime, plural, todayISO } from '../format';
import { ChecklistDialog } from './Checklist';
import { Icon } from './Icon';
import { LoadMeter, onBoardKg, sumKg } from './LoadMeter';
import { Button, Card, CardTitle, ErrorText, Muted, Pill } from './ui';

/** Quantos dias à frente aparecem em "Próximas cargas". */
const UPCOMING_DAYS = 30;

const Stops = styled.ol`
  list-style: none;
  margin: ${({ theme }) => theme.space(2)} 0 0;
  padding: 0;

  li {
    display: flex;
    align-items: flex-start;
    gap: ${({ theme }) => theme.space(2)};
    padding: ${({ theme }) => theme.space(2)} 0;
    border-top: 1px solid ${({ theme }) => theme.color.border};
  }
`;

const StopNumber = styled.span`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${({ theme }) => theme.color.primary};
  color: ${({ theme }) => theme.color.textInvert};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  display: grid;
  place-items: center;
`;

const StopInfo = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;

  strong { font-size: ${({ theme }) => theme.font.size.lg}; color: ${({ theme }) => theme.color.textStrong}; }
  span { font-size: ${({ theme }) => theme.font.size.md}; }
  small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const Totals = styled.p`
  margin: ${({ theme }) => `${theme.space(1)} 0 ${theme.space(2)}`};
  font-size: ${({ theme }) => theme.font.size.md};
  strong { color: ${({ theme }) => theme.color.textStrong}; }
`;

const StartRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${({ theme }) => theme.space(2)};
  margin-top: ${({ theme }) => theme.space(2)};
`;

const Rows = styled.ul`
  list-style: none;
  margin: ${({ theme }) => theme.space(1)} 0 0;
  padding: 0;

  > li { padding: ${({ theme }) => theme.space(1.5)} 0; border-top: 1px solid ${({ theme }) => theme.color.border}; }
  details summary { cursor: pointer; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  details ul { margin: 8px 0 0; padding-left: 20px; font-size: ${({ theme }) => theme.font.size.md}; }
  strong { color: ${({ theme }) => theme.color.textStrong}; }
  small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const dayLabel = (day: string) => (day === todayISO(1) ? 'Amanhã' : capitalize(fmtDay(day)));

function StopDetails({ d }: { d: Delivery }) {
  const extra = [d.invoice_number && `NF ${d.invoice_number}`, d.volumes && plural(d.volumes, 'volume', 'volumes'), fmtKg(d.weight_kg)];
  return (
    <StopInfo>
      <strong>{d.customer_name}</strong>
      <span>{d.address} · {d.city}</span>
      <small>{extra.filter(Boolean).join(' · ')}</small>
    </StopInfo>
  );
}

/** Sem rota em andamento: o que está no caminhão agora vira a próxima rota, com o valor previsto e "Iniciar rota". */
export function NextRoute() {
  const today = todayISO();
  const deliveries = useDeliveries(today);
  const vehicles = useVehicles();
  const estimate = useRegionEstimates(today).data?.[0];
  const start = useStartRun();
  const [checking, setChecking] = useState(false);
  const vehicle = vehicles.data?.[0];
  // Só o que ainda está no caminhão para entregar (as das rotas já encerradas ficam em "Rotas de hoje")
  const load = (deliveries.data ?? []).filter((d) => d.status === 'assigned').sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
  const volumes = load.reduce((total, d) => total + (d.volumes ?? 0), 0);

  return (
    <Card aria-label="Próxima rota">
      <CardTitle>Próxima rota</CardTitle>
      {deliveries.isLoading && <Muted style={{ marginTop: 8 }}>Carregando…</Muted>}
      {deliveries.isError && <ErrorText role="alert">{errorMessage(deliveries.error)}</ErrorText>}
      {deliveries.isSuccess && load.length === 0 && (
        <Muted style={{ marginTop: 8 }}>Nenhuma carga no caminhão agora. Quando a base carregar, você recebe um aviso e ela aparece aqui.</Muted>
      )}
      {load.length > 0 && (
        <>
          <Totals>
            <strong>{plural(load.length, 'entrega', 'entregas')}</strong> · {fmtKg(sumKg(load))}
            {volumes > 0 && ` · ${plural(volumes, 'volume', 'volumes')}`}
          </Totals>
          <LoadMeter loadedKg={onBoardKg(load)} capacityKg={vehicle?.capacity_kg ?? null} />
          {vehicles.isSuccess && !vehicle?.capacity_kg && (
            <Muted style={{ marginTop: 4, fontSize: 12 }}>
              <Link to="/meu-veiculo">Informe a capacidade do seu veículo</Link> para conferir o peso.
            </Muted>
          )}
          {estimate?.price != null && (
            <Muted style={{ marginTop: 8 }}>
              Valor desta rota: <strong>{fmtBRL(estimate.price)}</strong> ({estimate.region_name}). É fixo pela região, não importa quantas
              entregas.
            </Muted>
          )}
          <StartRow>
            <Button type="button" disabled={!vehicle || start.isPending} onClick={() => setChecking(true)}>
              <Icon name="navigation" size={20} />
              {start.isPending ? 'Calculando a melhor rota…' : 'Iniciar rota'}
            </Button>
            <Muted style={{ flex: '1 1 260px', fontSize: 12 }}>
              {vehicle
                ? 'Primeiro o checklist do veículo; depois a melhor ordem das paradas pelas ruas e a contagem dos km.'
                : <><Link to="/meu-veiculo">Cadastre seu veículo</Link> para iniciar a rota.</>}
            </Muted>
          </StartRow>
          {start.isError && <ErrorText role="alert" style={{ marginTop: 12 }}>{errorMessage(start.error)}</ErrorText>}
          <ChecklistDialog
            open={checking}
            starting={start.isPending}
            onClose={() => setChecking(false)}
            onDone={(checklistId) => start.mutate({ day: today, checklistId }, { onSettled: () => setChecking(false) })}
          />
          <Stops aria-label="Paradas da próxima rota">
            {load.map((d, i) => (
              <li key={d.id}>
                <StopNumber aria-hidden="true">{i + 1}</StopNumber>
                <StopDetails d={d} />
              </li>
            ))}
          </Stops>
        </>
      )}
    </Card>
  );
}

/** Cargas já colocadas no caminhão para os próximos dias. */
export function UpcomingLoads() {
  const upcoming = useDeliveriesBetween(todayISO(1), todayISO(UPCOMING_DAYS));
  const list = (upcoming.data ?? []).filter((d) => d.status === 'assigned');
  const days = [...new Set(list.map((d) => d.scheduled_for))].sort();
  if (!days.length) return null;
  return (
    <Card aria-label="Próximas cargas">
      <CardTitle>Próximas cargas</CardTitle>
      <Rows>
        {days.map((day) => {
          const items = list.filter((d) => d.scheduled_for === day).sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
          return (
            <li key={day}>
              <details>
                <summary>
                  <strong>{dayLabel(day)}</strong>
                  <small>{plural(items.length, 'entrega', 'entregas')} · {fmtKg(sumKg(items))}</small>
                </summary>
                <ul>
                  {items.map((d) => <li key={d.id}>{d.customer_name} · {d.city} · {fmtKg(d.weight_kg)}</li>)}
                </ul>
              </details>
            </li>
          );
        })}
      </Rows>
    </Card>
  );
}

/** Rotas já encerradas hoje (o detalhe, com as fotos, fica em Rotas feitas). */
export function TodayRuns() {
  const today = todayISO();
  const history = useRunHistory(today, today);
  const done = (history.data ?? []).filter((r) => r.status === 'finished');
  if (!done.length) return null;
  return (
    <Card aria-label="Rotas de hoje">
      <CardTitle>Rotas encerradas hoje</CardTitle>
      <Rows>
        {done.map((r) => {
          const delivered = r.stops.filter((d) => d.status === 'delivered').length;
          return (
            <li key={r.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
              <span>
                <strong>Rota {r.day_index}</strong> <small>· {fmtTime(r.started_at)}–{fmtTime(r.finished_at!)} · {delivered} de {plural(r.stops.length, 'entrega', 'entregas')}</small>
              </span>
              {r.payment
                ? <Pill $tone={r.payment.status === 'paid' ? 'success' : 'warning'}>{fmtBRL(r.payment.amount)} · {r.payment.status === 'paid' ? 'recebido' : 'a receber'}</Pill>
                : r.region_price !== null && <Pill $tone="neutral">{fmtBRL(r.region_price)} pela tabela</Pill>}
            </li>
          );
        })}
      </Rows>
      <Muted style={{ marginTop: 12 }}><Link to="/rotas-feitas">Ver as entregas e as fotos em Rotas feitas</Link></Muted>
    </Card>
  );
}
