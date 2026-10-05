import { useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useCompanyBase, usePaymentsOverview, useRun, useRunHistory } from '../api/queries';
import type { Delivery, RunHistory } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ChecklistBadge, ChecklistView } from '../components/Checklist';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { ProofThumb, ProofView, REASON_LABEL } from '../components/Proof';
import { RegionTableView } from '../components/RegionTable';
import { RunMap } from '../components/RunMap';
import { Button, Card, ErrorText, Muted, PageHeader, Pill } from '../components/ui';
import { fmtBRL, fmtDate, fmtDay, fmtKg, fmtKm, fmtTime, plural, todayISO } from '../format';
import { PERIODS, periodRange, type Period } from '../period';

const Chips = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const Chip = styled.button<{ $active: boolean }>`
  height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  border: 1.5px solid ${({ theme }) => theme.color.primary};
  background: ${({ theme, $active }) => ($active ? theme.color.primary : theme.color.surface)};
  color: ${({ theme, $active }) => ($active ? theme.color.textInvert : theme.color.primary)};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  cursor: pointer;
`;

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: ${({ theme }) => theme.space(2)};
`;

const Kpi = styled(Card)<{ $tone?: 'caution' | 'success' }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  > span { color: ${({ theme }) => theme.color.textSoft}; }
  > strong {
    font-size: ${({ theme }) => theme.font.size.h2};
    color: ${({ theme, $tone }) => ($tone === 'caution' ? theme.color.cautionInk : $tone === 'success' ? theme.color.successInk : theme.color.textStrong)};
  }
  > small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const DayTitle = styled.h2`
  margin: ${({ theme }) => theme.space(1)} 0 0;
  font-size: ${({ theme }) => theme.font.size.lg};
  color: ${({ theme }) => theme.color.textSoft};
`;

const RunHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space(1)};

  h3 { font-size: ${({ theme }) => theme.font.size.lg}; color: ${({ theme }) => theme.color.textStrong}; }
  small { display: block; font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const Value = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  strong { font-size: ${({ theme }) => theme.font.size.xl}; color: ${({ theme }) => theme.color.textStrong}; }
`;

const Stops = styled.ul`
  list-style: none;
  margin: ${({ theme }) => theme.space(2)} 0 0;
  padding: 0;

  > li {
    display: flex;
    align-items: flex-start;
    gap: ${({ theme }) => theme.space(2)};
    padding: ${({ theme }) => theme.space(1.5)} 0;
    border-top: 1px solid ${({ theme }) => theme.color.border};
  }
`;

const Info = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  strong { color: ${({ theme }) => theme.color.textStrong}; }
  small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  em { font-size: ${({ theme }) => theme.font.size.sm}; }
`;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const dayTitle = (day: string) => (day === todayISO() ? 'Hoje' : day === todayISO(-1) ? 'Ontem' : capitalize(fmtDay(day)));

function Outcome({ d }: { d: Delivery }) {
  const at = d.proof ? ` às ${fmtTime(d.proof.created_at)}` : '';
  if (d.status === 'delivered') return <Pill $tone="success">Entregue{at}</Pill>;
  if (d.status === 'failed') return <Pill $tone="danger">Não recebida{at} · {REASON_LABEL[d.proof?.reason ?? 'other']}</Pill>;
  return <Pill $tone="neutral">Não entregue</Pill>;
}

function RunValue({ run }: { run: RunHistory }) {
  if (run.payment) {
    return (
      <Value>
        <strong>{fmtBRL(run.payment.amount)}</strong>
        {run.payment.status === 'paid'
          ? <Pill $tone="success">Recebido em {fmtDate(run.payment.paid_on!)}</Pill>
          : <Pill $tone="warning">A receber</Pill>}
      </Value>
    );
  }
  if (run.status === 'active') return <Pill $tone="success">Em andamento</Pill>;
  if (run.region_price !== null) {
    return (
      <Value>
        <strong>{fmtBRL(run.region_price)}</strong>
        <Pill $tone="neutral">Ainda não lançado pela base</Pill>
      </Value>
    );
  }
  return <Pill $tone="neutral">Sem valor</Pill>;
}

function RunMapDialog({ runId, onClose }: { runId: number | null; onClose: () => void }) {
  const run = useRun(runId);
  const base = useCompanyBase();
  return (
    <Dialog open={runId !== null} title="Rota no mapa" onClose={onClose}>
      {run.isLoading && <Muted>Carregando o mapa…</Muted>}
      {run.isError && <ErrorText role="alert">{errorMessage(run.error)}</ErrorText>}
      {run.data && (
        <Stack>
          <Muted style={{ fontSize: 12 }}>Vermelho: o traçado planejado. Tracejado: por onde o caminhão passou.</Muted>
          <RunMap base={base.data} stops={run.data.stops} geometry={run.data.geometry} trail={run.data.trail} position={null} />
        </Stack>
      )}
    </Dialog>
  );
}

const EXPENSE_STATUS = { pending: 'esperando a base', approved: 'aprovada', rejected: 'recusada' } as const;

function RunCard({ run, onPhoto, onMap, onChecklist }: {
  run: RunHistory;
  onPhoto: (d: Delivery) => void;
  onMap: () => void;
  onChecklist: (id: number) => void;
}) {
  const delivered = run.stops.filter((d) => d.status === 'delivered').length;
  const time = run.finished_at ? `${fmtTime(run.started_at)}–${fmtTime(run.finished_at)}` : `desde ${fmtTime(run.started_at)}`;
  return (
    <Card aria-label={`Rota ${run.day_index} de ${dayTitle(run.day)}`}>
      <RunHead>
        <div>
          <h3>Rota {run.day_index} · {time}</h3>
          <small>
            {fmtKm(run.distance_km)} · {run.load_kg !== null ? `${fmtKg(run.load_kg)} · ` : ''}
            {delivered} de {plural(run.stops.length, 'entrega', 'entregas')}
            {run.region_name ? ` · ${run.region_name}` : ''} · {run.plate}
          </small>
        </div>
        <RunValue run={run} />
      </RunHead>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        <ChecklistBadge checklist={run.checklist} onOpen={onChecklist} />
        {run.expenses.map((e) => (
          <Pill key={e.id} $tone={e.status === 'approved' ? 'success' : e.status === 'rejected' ? 'danger' : 'warning'}>
            {e.kind_label} {fmtBRL(e.amount)} · {EXPENSE_STATUS[e.status]}
          </Pill>
        ))}
      </div>
      <Stops aria-label={`Entregas da rota ${run.day_index}`}>
        {run.stops.map((d) => (
          <li key={d.id}>
            {d.proof && <ProofThumb delivery={d} onOpen={() => onPhoto(d)} />}
            <Info>
              <strong>{d.customer_name}</strong>
              <small>{d.address} · {d.city} · {fmtKg(d.weight_kg)}{d.invoice_number ? ` · NF ${d.invoice_number}` : ''}</small>
              <div style={{ marginTop: 4 }}><Outcome d={d} /></div>
              {d.proof?.receiver_name && <small>Recebido por {d.proof.receiver_name}{d.proof.has_signature ? ' (assinou)' : ''}</small>}
              {d.proof?.note && <em>“{d.proof.note}”</em>}
            </Info>
          </li>
        ))}
      </Stops>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {run.status === 'active'
          ? <Link to="/minha-rota">Abrir a rota em andamento</Link>
          : (
            <Button type="button" $variant="secondary" style={{ height: 36 }} onClick={onMap}>
              <Icon name="map" size={18} />
              Ver no mapa
            </Button>
          )}
      </div>
    </Card>
  );
}

/** Motorista: cada rota feita com as entregas, as fotos que comprovam e o valor; no topo, quanto tem a receber. */
export function RouteHistoryPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>('month');
  const [photo, setPhoto] = useState<Delivery | null>(null);
  const [mapRun, setMapRun] = useState<number | null>(null);
  const [checklistId, setChecklistId] = useState<number | null>(null);
  const { date_from, date_to } = periodRange(period);
  const history = useRunHistory(date_from, date_to);
  const overview = usePaymentsOverview({ dateFrom: date_from, dateTo: date_to });
  const balance = overview.data?.balances.find((b) => b.driver_id === user?.id);
  const runs = history.data ?? [];
  const days = [...new Set(runs.map((r) => r.day))];

  return (
    <>
      <PageHeader>
        <div style={{ flexGrow: 1 }}>
          <h1>Rotas feitas</h1>
          <Muted>Cada rota com as entregas, as fotos que comprovam e o valor que você recebe por ela.</Muted>
        </div>
      </PageHeader>

      <Stack>
        <Grid>
          <Kpi $tone={balance?.pending_amount ? 'caution' : undefined} aria-live="polite">
            <span>A receber</span>
            <strong>{fmtBRL(balance?.pending_amount ?? 0)}</strong>
            <small>{balance?.pending_count ? plural(balance.pending_count, 'rota ainda não paga', 'rotas ainda não pagas') : 'nada pendente'}</small>
          </Kpi>
          <Kpi $tone={balance?.paid_amount ? 'success' : undefined}>
            <span>Recebido no período</span>
            <strong>{fmtBRL(balance?.paid_amount ?? 0)}</strong>
            <small>{plural(balance?.paid_count ?? 0, 'pagamento', 'pagamentos')}</small>
          </Kpi>
          <Kpi>
            <span>Rotas no período</span>
            <strong>{runs.length}</strong>
            <small>{fmtKm(runs.reduce((km, r) => km + r.distance_km, 0))} rodados</small>
          </Kpi>
        </Grid>

        <Chips role="group" aria-label="Período">
          {PERIODS.map((p) => (
            <Chip key={p.value} type="button" $active={period === p.value} aria-pressed={period === p.value} onClick={() => setPeriod(p.value)}>
              {p.label}
            </Chip>
          ))}
        </Chips>

        {history.isLoading && <Muted>Carregando rotas…</Muted>}
        {history.isError && <ErrorText role="alert">{errorMessage(history.error)}</ErrorText>}
        {history.isSuccess && runs.length === 0 && (
          <Card><Muted>Nenhuma rota nesse período. As rotas aparecem aqui assim que você toca em “Iniciar rota”.</Muted></Card>
        )}
        {days.map((day) => (
          <Stack key={day} as="section" aria-label={dayTitle(day)}>
            <DayTitle>{dayTitle(day)}</DayTitle>
            {runs.filter((r) => r.day === day).map((r) => (
              <RunCard key={r.id} run={r} onPhoto={setPhoto} onMap={() => setMapRun(r.id)} onChecklist={setChecklistId} />
            ))}
          </Stack>
        ))}

        <RegionTableView />
      </Stack>

      <ProofView delivery={photo} onClose={() => setPhoto(null)} />
      <RunMapDialog runId={mapRun} onClose={() => setMapRun(null)} />
      <ChecklistView checklistId={checklistId} onClose={() => setChecklistId(null)} />
    </>
  );
}
