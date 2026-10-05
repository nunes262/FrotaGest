import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useCompanyBase, useCurrentRun, useEndPause, useFinishRun, useReplanRun, useStartPause } from '../api/queries';
import type { Delivery, DeliveryRun, LatLng, PauseKind, RunPause, RunStop } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AppSetupCard } from '../components/AppSetup';
import { DriverRecords } from '../components/DriverRecords';
import { Icon } from '../components/Icon';
import { NextRoute, TodayRuns, UpcomingLoads } from '../components/NextRoute';
import { ProofDialog, ProofView, REASON_LABEL } from '../components/Proof';
import { useGpsStatus, type GpsStatus } from '../components/RunGps';
import { RunMap } from '../components/RunMap';
import { fmtPct, tirePositionLabel, TireToneBadge } from '../components/Tires';
import { Button, Card, CardTitle, ErrorText, Muted, PageHeader, Pill, SuccessText } from '../components/ui';
import { fmtBRL, fmtDuration, fmtKg, fmtKm, fmtTime, plural } from '../format';
import { distanceKm } from '../geo';

// Lei 13.103: no máximo 5h30 de direção contínua e no mínimo 1 h de refeição
const DRIVING_LIMIT_MIN = 330;
const DRIVING_WARNING_MIN = 300;
const MEAL_MIN = 60;
// Perto disso do endereço, a parada aparece como "Você chegou"
const ARRIVAL_KM = 0.3;

const PAUSE_LABEL: Record<PauseKind, string> = { meal: 'Refeição', rest: 'Descanso', wait: 'Espera (carga/descarga)' };

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const Stats = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: ${({ theme }) => theme.space(2)};
`;

const Stat = styled(Card)`
  display: flex;
  flex-direction: column;
  gap: 4px;

  > span:first-child { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  > strong { font-size: ${({ theme }) => theme.font.size.h2}; color: ${({ theme }) => theme.color.textStrong}; }
  > small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const Notice = styled.div<{ $tone: 'caution' | 'neutral' | 'success' }>`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space(1)};
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme, $tone }) => ({ caution: theme.color.cautionTint, neutral: theme.color.neutralTint, success: theme.color.successTint })[$tone]};
  color: ${({ theme, $tone }) => ({ caution: theme.color.cautionInk, neutral: theme.color.text, success: theme.color.successInk })[$tone]};
  font-size: ${({ theme }) => theme.font.size.md};
`;

const Arrival = styled(Card)`
  border: 2px solid ${({ theme }) => theme.color.success};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space(2)};

  strong { display: block; font-size: ${({ theme }) => theme.font.size.lg}; color: ${({ theme }) => theme.color.textStrong}; }
`;

const PauseBox = styled(Card)<{ $paused: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
  ${({ theme, $paused }) => $paused && `border: 2px solid ${theme.color.caution}; background: ${theme.color.cautionTint};`}
`;

const Timer = styled.strong`
  font-size: ${({ theme }) => theme.font.size.h1};
  font-variant-numeric: tabular-nums;
  color: ${({ theme }) => theme.color.textStrong};
`;

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${({ theme }) => theme.space(1)};
`;

const Stops = styled.ol`
  list-style: none;
  margin: ${({ theme }) => theme.space(2)} 0 0;
  padding: 0;

  > li {
    display: flex;
    align-items: flex-start;
    gap: ${({ theme }) => theme.space(2)};
    padding: ${({ theme }) => theme.space(2)} 0;
    border-bottom: 1px solid ${({ theme }) => theme.color.border};
  }
  > li:last-child { border-bottom: 0; padding-bottom: 0; }
`;

const StopNumber = styled.span<{ $tone: 'next' | 'done' | 'failed' | 'todo' }>`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${({ theme, $tone }) => ({ next: theme.color.primary, done: theme.color.success, failed: theme.color.danger, todo: theme.color.textStrong })[$tone]};
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
  small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  a { font-size: ${({ theme }) => theme.font.size.md}; font-weight: ${({ theme }) => theme.font.weight.semibold}; color: ${({ theme }) => theme.color.primary}; }
`;

const Tags = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
`;

const LinkButton = styled.button`
  all: unset;
  cursor: pointer;
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.primary};
  text-decoration: underline;
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; }
`;

const gpsText: Record<GpsStatus, string> = {
  off: '',
  waiting: 'Esperando o sinal do GPS do celular…',
  active: 'GPS do celular ligado',
  denied: 'Localização do celular bloqueada: permita no navegador para registrar os km pelo celular.',
  unavailable: 'GPS do celular indisponível neste navegador (precisa de HTTPS).',
};

const kmSourceText = (run: Pick<DeliveryRun, 'km_source'>) =>
  run.km_source === 'tracker' ? 'pelo rastreador do veículo' : run.km_source === 'phone' ? 'pelo GPS do celular' : 'aguardando posições';

const isDone = (d: Delivery) => d.status === 'delivered' || d.status === 'failed';

/** Link de navegação passo a passo no Google Maps até a parada. */
const mapsUrl = (s: RunStop) => {
  const destination = s.latitude !== null ? `${s.latitude},${s.longitude}` : `${s.delivery.address}, ${s.delivery.city}`;
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(destination)}`;
};

/** Mensagem pronta no WhatsApp do cliente: quem está chegando e em quanto tempo (estimado pela distância). */
function whatsappUrl(d: Delivery, driverName: string, etaMin: number | null) {
  const nf = d.invoice_number ? ` da nota ${d.invoice_number}` : '';
  const eta = etaMin !== null ? ` e chego em cerca de ${etaMin} min` : '';
  const text = `Olá, ${d.customer_name}! Aqui é ${driverName}, motorista da sua entrega${nf}. Estou a caminho${eta}.`;
  return `https://wa.me/55${d.customer_phone}?text=${encodeURIComponent(text)}`;
}

/** Tempo até a parada: distância em linha reta + 30% (ruas), a 30 km/h na cidade. */
const etaMinutes = (from: LatLng | null, s: RunStop) =>
  from && s.latitude !== null ? Math.max(2, Math.round(((distanceKm(from, [s.latitude, s.longitude!]) * 1.3) / 30) * 60)) : null;

const precisionText: Record<string, string> = {
  street: 'Localização pela rua (sem o número)',
  city: 'Localização aproximada (centro da cidade)',
};

/** Relógio que anda sozinho (para cronômetros). */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

const minutesBetween = (from: string, to: number) => Math.max(0, Math.floor((to - new Date(from).getTime()) / 60_000));

function clock(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function PauseCard({ run }: { run: DeliveryRun }) {
  const start = useStartPause();
  const end = useEndPause();
  const pause = run.active_pause;
  const now = useNow(pause ? 1_000 : 30_000);
  const busy = start.isPending || end.isPending;
  const finished = run.pauses.filter((p): p is RunPause & { ended_at: string } => Boolean(p.ended_at));
  const lastBreak = finished.length ? finished[finished.length - 1].ended_at : run.started_at;
  const driving = minutesBetween(lastBreak, now);

  if (pause) {
    const seconds = Math.max(0, Math.floor((now - new Date(pause.started_at).getTime()) / 1000));
    const mealLeft = MEAL_MIN - Math.floor(seconds / 60);
    return (
      <PauseBox $paused aria-label="Pausa">
        <Row style={{ justifyContent: 'space-between' }}>
          <div>
            <Pill $tone="caution">Em pausa · {PAUSE_LABEL[pause.kind]}</Pill>
            <div style={{ marginTop: 8 }}><Timer aria-live="off">{clock(seconds)}</Timer></div>
            <Muted style={{ fontSize: 12 }}>
              Desde {fmtTime(pause.started_at)}
              {pause.kind === 'meal' && (mealLeft > 0
                ? ` · faltam ${mealLeft} min para completar 1 h de refeição (Lei 13.103)`
                : ' · 1 h de refeição completa')}
            </Muted>
          </div>
          <Button type="button" disabled={busy} onClick={() => end.mutate(run.id)}>
            <Icon name="play" size={18} />
            {end.isPending ? 'Retomando…' : 'Retomar rota'}
          </Button>
        </Row>
        {end.isError && <ErrorText role="alert">{errorMessage(end.error)}</ErrorText>}
      </PauseBox>
    );
  }

  return (
    <PauseBox $paused={false} aria-label="Pausa">
      <div>
        <CardTitle>Pausas</CardTitle>
        <Muted style={{ marginTop: 4 }}>
          Dirigindo há {fmtDuration(driving)} desde {finished.length ? 'a última pausa' : 'o início da rota'}.
        </Muted>
      </div>
      {driving >= DRIVING_WARNING_MIN && (
        <Notice $tone="caution" role="status">
          {driving >= DRIVING_LIMIT_MIN
            ? 'Você passou de 5h30 de direção contínua. Pare para descansar pelo menos 30 min.'
            : 'Faça uma pausa de 30 min em breve: a lei limita a direção contínua a 5h30.'}
        </Notice>
      )}
      <Row>
        <Button type="button" disabled={busy} onClick={() => start.mutate({ runId: run.id, kind: 'meal' })}>
          <Icon name="pause" size={18} />
          Pausa para refeição
        </Button>
        <Button type="button" $variant="secondary" disabled={busy} onClick={() => start.mutate({ runId: run.id, kind: 'rest' })}>Descanso</Button>
        <Button type="button" $variant="secondary" disabled={busy} onClick={() => start.mutate({ runId: run.id, kind: 'wait' })}>Espera (carga/descarga)</Button>
      </Row>
      {finished.length > 0 && (
        <Muted style={{ fontSize: 12 }}>
          Hoje: {finished.map((p) => `${PAUSE_LABEL[p.kind]} ${fmtTime(p.started_at)}–${fmtTime(p.ended_at)} (${fmtDuration(minutesBetween(p.started_at, new Date(p.ended_at).getTime()))})`).join(' · ')}
        </Muted>
      )}
      {start.isError && <ErrorText role="alert">{errorMessage(start.error)}</ErrorText>}
    </PauseBox>
  );
}

function StopOutcome({ d, onView }: { d: Delivery; onView: () => void }) {
  if (d.status === 'delivered') {
    return (
      <>
        <Pill $tone="success">Entregue{d.proof ? ` às ${fmtTime(d.proof.created_at)}` : ''}</Pill>
        {d.proof && <LinkButton type="button" onClick={onView}>ver foto</LinkButton>}
      </>
    );
  }
  if (d.status === 'failed') {
    return (
      <>
        <Pill $tone="danger">Não entregue · {REASON_LABEL[d.proof?.reason ?? 'other']}</Pill>
        {d.proof && <LinkButton type="button" onClick={onView}>ver foto</LinkButton>}
      </>
    );
  }
  return null;
}

function RunSummaryCard({ run }: { run: DeliveryRun }) {
  const delivered = run.stops.filter((s) => s.delivery.status === 'delivered').length;
  const failed = run.stops.filter((s) => s.delivery.status === 'failed').length;
  return (
    <Card>
      <CardTitle>Rota encerrada</CardTitle>
      <Muted style={{ marginTop: 8 }}>
        {fmtKm(run.distance_km)} rodados ({kmSourceText(run)}) · {plural(delivered, 'entrega feita', 'entregas feitas')}
        {run.load_kg !== null && ` · ${fmtKg(run.load_kg)} levados`}
        {run.region_price !== null && ` · ${fmtBRL(run.region_price)} pela região ${run.region_name}`}
        {failed > 0 && ` · ${plural(failed, 'não entregue', 'não entregues')}`}
        {run.tire_wear_pct !== null && ` · desgaste estimado de ${fmtPct(run.tire_wear_pct)} nos pneus`}.
      </Muted>
      <Muted style={{ marginTop: 16 }}><Link to="/rotas-feitas">Ver as entregas e as fotos em Rotas feitas</Link></Muted>
    </Card>
  );
}

export function RunPage() {
  const { user } = useAuth();
  const [queued, setQueued] = useState(false);
  const current = useCurrentRun();
  const base = useCompanyBase();
  const finish = useFinishRun();
  const replan = useReplanRun();
  const gps = useGpsStatus();
  const [proof, setProof] = useState<{ delivery: Delivery; outcome: 'delivered' | 'failed' } | null>(null);
  const [viewing, setViewing] = useState<Delivery | null>(null);
  const run = current.data;

  if (current.isLoading) return <Muted>Carregando rota…</Muted>;
  if (!run) {
    // Sem rota em andamento: a próxima rota (o que está no caminhão), as próximas cargas e as rotas de hoje
    return (
      <>
        <PageHeader>
          <div style={{ flexGrow: 1 }}>
            <h1>Minha rota</h1>
            <Muted>Uma rota por vez: a carga que está no caminhão agora vira a próxima rota.</Muted>
          </div>
        </PageHeader>
        <Stack>
          {finish.data && (
            <>
              <SuccessText role="status">Rota encerrada. Os km rodados já entraram na conta dos pneus e dos custos.</SuccessText>
              <RunSummaryCard run={finish.data} />
            </>
          )}
          <NextRoute />
          <Card aria-label="Registros">
            <CardTitle style={{ marginBottom: 12 }}>Registros</CardTitle>
            <DriverRecords />
          </Card>
          <UpcomingLoads />
          <TodayRuns />
          <AppSetupCard text="Receba a carga nova e os pagamentos mesmo com o app fechado, e deixe o FrotaGest na tela inicial." />
        </Stack>
      </>
    );
  }

  const next = run.stops.find((s) => !isDone(s.delivery));
  // Com o rastreador simulado (opções de dev), a posição é a do caminhão simulado, não a do celular de quem testa
  const position: LatLng | null = run.simulated ? run.current_position : gps.position ?? run.current_position;
  const arrived =
    next && position && next.latitude !== null && distanceKm(position, [next.latitude, next.longitude!]) <= ARRIVAL_KM ? next : null;
  const allDone = run.stops.length > 0 && !next;
  const atBase =
    allDone && position && base.data
      ? distanceKm(position, [base.data.latitude, base.data.longitude]) * 1000 <= Math.max(base.data.radius_m, ARRIVAL_KM * 1000)
      : false;
  const busy = finish.isPending || replan.isPending;
  const openProof = (delivery: Delivery, outcome: 'delivered' | 'failed') => setProof({ delivery, outcome });

  return (
    <>
      <PageHeader>
        <div style={{ flexGrow: 1 }}>
          <h1>Rota em andamento</h1>
          <Muted>
            Iniciada às {fmtTime(run.started_at)} · {run.plate} · {plural(run.stops.length, 'parada', 'paradas')} na melhor ordem
            {run.returns_to_base ? ', voltando à base' : ''}
          </Muted>
          {run.region_price !== null && (
            <Muted style={{ marginTop: 4 }}>
              Valor da rota: <strong>{fmtBRL(run.region_price)}</strong> ({run.region_name}), fixo pela região
            </Muted>
          )}
          {run.simulated && <Pill $tone="caution" style={{ marginTop: 8 }}>Rastreador simulado (opções de dev)</Pill>}
        </div>
        <Button
          type="button"
          $variant={allDone ? 'primary' : 'secondary'}
          disabled={busy}
          onClick={() => window.confirm('Encerrar a rota? Os km rodados ficam registrados.') && finish.mutate(run.id)}
        >
          {finish.isPending ? 'Encerrando…' : 'Encerrar rota'}
        </Button>
      </PageHeader>

      <Stack>
        {(finish.isError || replan.isError) && <ErrorText role="alert">{errorMessage(finish.error ?? replan.error)}</ErrorText>}
        {arrived && !run.active_pause && (
          <Arrival aria-live="polite">
            <div>
              <Muted>Você chegou</Muted>
              <strong>{arrived.delivery.customer_name}</strong>
              <Muted style={{ fontSize: 12 }}>{arrived.delivery.address} · {arrived.delivery.city}</Muted>
            </div>
            <Row>
              <Button type="button" onClick={() => openProof(arrived.delivery, 'delivered')}>
                <Icon name="camera" size={18} />
                Entregue
              </Button>
              <Button type="button" $variant="secondary" onClick={() => openProof(arrived.delivery, 'failed')}>Não recebeu</Button>
            </Row>
          </Arrival>
        )}
        {atBase && !run.active_pause && (
          <Arrival aria-live="polite">
            <div>
              <Muted>Você voltou à base</Muted>
              <strong>{base.data?.name}</strong>
              <Muted style={{ fontSize: 12 }}>Todas as paradas foram resolvidas. Encerre a rota para registrar os km.</Muted>
            </div>
            <Button type="button" disabled={busy} onClick={() => finish.mutate(run.id)}>
              {finish.isPending ? 'Encerrando…' : 'Encerrar rota'}
            </Button>
          </Arrival>
        )}
        {allDone && !atBase && (
          <Notice $tone="success" role="status">
            Todas as paradas foram resolvidas. Volte para a base e encerre a rota.
          </Notice>
        )}
        {run.needs_replan && (
          <Notice $tone="caution" role="status">
            <span>O carregamento mudou depois do cálculo da rota. Recalcule para encaixar as entregas na melhor ordem.</span>
            <Button type="button" $variant="secondary" disabled={busy} onClick={() => replan.mutate(run.id)}>
              {replan.isPending ? 'Calculando…' : 'Recalcular rota'}
            </Button>
          </Notice>
        )}
        {!run.optimized && (
          <Notice $tone="neutral">
            O serviço de navegação não respondeu: a ordem foi aproximada pela distância em linha reta.
            <Button type="button" $variant="secondary" disabled={busy} onClick={() => replan.mutate(run.id)}>Tentar de novo</Button>
          </Notice>
        )}

        {queued && (
          <Notice $tone="neutral" role="status">
            Sem sinal: o registro ficou guardado no celular e vai sozinho quando o sinal voltar. Pode seguir para a próxima parada.
          </Notice>
        )}
        <PauseCard run={run} />
        <Card aria-label="Registros">
          <CardTitle style={{ marginBottom: 12 }}>Registros da rota</CardTitle>
          <DriverRecords />
        </Card>

        <Stats>
          <Stat aria-live="polite">
            <span>Km rodados</span>
            <strong>{fmtKm(run.distance_km)}</strong>
            <small>{kmSourceText(run)}</small>
          </Stat>
          <Stat>
            <span>Rota planejada</span>
            <strong>{run.planned_distance_km !== null ? fmtKm(run.planned_distance_km) : '–'}</strong>
            <small>
              {run.planned_duration_min ? `cerca de ${fmtDuration(run.planned_duration_min)} dirigindo` : 'tempo não calculado'}
              {run.return_km ? ` · ${fmtKm(run.return_km)} da volta` : ''}
            </small>
          </Stat>
          <Stat>
            <span>Carga no caminhão</span>
            <strong>{fmtKg(run.stops.reduce((kg, s) => kg + (s.delivery.on_board ? s.delivery.weight_kg : 0), 0))}</strong>
            <small>
              {run.load_kg !== null ? `de ${fmtKg(run.load_kg)} carregados nesta rota` : 'peso das entregas que faltam'}
            </small>
          </Stat>
          <Stat>
            <span>Desgaste dos pneus nesta rota</span>
            <strong>{run.tire_wear_pct !== null ? fmtPct(run.tire_wear_pct) : '–'}</strong>
            {run.worst_tire ? (
              <small>
                Mais gasto: {tirePositionLabel(run.worst_tire.position)} <TireToneBadge wear={run.worst_tire.wear_pct} />{' '}
                <Link to="/meu-veiculo#pneus">ver pneus</Link>
              </small>
            ) : (
              <small>Os pneus do veículo ainda não foram cadastrados pela base.</small>
            )}
          </Stat>
        </Stats>

        <Card>
          <CardTitle style={{ marginBottom: 8 }}>Mapa</CardTitle>
          {run.simulated ? (
            <Muted style={{ marginBottom: 12, fontSize: 12 }}>
              Posição do rastreador simulado: o caminhão anda sozinho pela rota. O GPS do celular não é usado enquanto a
              simulação estiver ligada.
            </Muted>
          ) : (
            gps.status !== 'off' && <Muted style={{ marginBottom: 12, fontSize: 12 }}>{gpsText[gps.status]}</Muted>
          )}
          <RunMap base={base.data} stops={run.stops} geometry={run.geometry} trail={run.trail} position={position} />
        </Card>

        <Card>
          <CardTitle>Paradas</CardTitle>
          <Stops aria-label="Paradas na ordem da rota">
            {run.stops.map((s) => {
              const d = s.delivery;
              const tone = d.status === 'delivered' ? 'done' : d.status === 'failed' ? 'failed' : d.id === next?.delivery.id ? 'next' : 'todo';
              return (
                <li key={d.id}>
                  <StopNumber $tone={tone} aria-hidden="true">
                    {d.status === 'delivered' ? <Icon name="check" size={18} /> : s.order}
                  </StopNumber>
                  <StopInfo>
                    <strong>{d.customer_name}</strong>
                    <span>{d.address} · {d.city}</span>
                    <small>
                      {s.leg_km !== null && `${fmtKm(s.leg_km)} desde ${s.order === 1 ? 'a saída' : 'a parada anterior'}`}
                      {d.invoice_number && ` · NF ${d.invoice_number}`}
                    </small>
                    <Tags>
                      {d.id === next?.delivery.id && <Pill $tone="success">Próxima</Pill>}
                      <StopOutcome d={d} onView={() => setViewing(d)} />
                      {!s.planned && <Pill $tone="caution">Fora da rota calculada</Pill>}
                      {s.planned && s.precision === null && <Pill $tone="caution">Endereço não localizado no mapa</Pill>}
                      {s.precision && precisionText[s.precision] && <Pill $tone="neutral">{precisionText[s.precision]}</Pill>}
                    </Tags>
                    {!isDone(d) && (
                      <Row style={{ marginTop: 8 }}>
                        <Button type="button" style={{ height: 40 }} onClick={() => openProof(d, 'delivered')} aria-label={`Entregue em ${d.customer_name}`}>
                          <Icon name="camera" size={18} />
                          Entregue
                        </Button>
                        <Button type="button" style={{ height: 40 }} $variant="secondary" onClick={() => openProof(d, 'failed')} aria-label={`${d.customer_name} não recebeu`}>
                          Não recebeu
                        </Button>
                        <a href={mapsUrl(s)} target="_blank" rel="noreferrer">
                          <Icon name="navigation" size={14} /> Navegar no Google Maps
                        </a>
                        {d.customer_phone && (
                          <a href={whatsappUrl(d, user?.name ?? 'o motorista', etaMinutes(position, s))} target="_blank" rel="noreferrer">
                            <Icon name="chat" size={14} /> Avisar cliente
                          </a>
                        )}
                      </Row>
                    )}
                  </StopInfo>
                </li>
              );
            })}
          </Stops>
        </Card>
      </Stack>

      <ProofDialog
        delivery={proof?.delivery ?? null}
        outcome={proof?.outcome ?? 'delivered'}
        position={position}
        onClose={() => setProof(null)}
        onQueued={() => setQueued(true)}
      />
      <ProofView delivery={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
