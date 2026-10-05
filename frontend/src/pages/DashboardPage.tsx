import { useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useCompanyBase, useDrivers, useLivePositions, useSummary, useTrackerCheck, useTrails, useVehicles } from '../api/queries';
import type { LatLng, LivePosition, LiveStatus, Vehicle, VehicleTrail } from '../api/types';
import { FleetMap, statusLabel, trailColor } from '../components/FleetMap';
import { TrackerCheckResult } from '../components/TrackerCheckResult';
import { Button, Card, CardTitle, Muted, PageHeader, Pill } from '../components/ui';
import { fmtKm, fmtTime } from '../format';

const Kpis = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: ${({ theme }) => theme.space(2)};
  margin-bottom: ${({ theme }) => theme.space(2)};
`;

const Kpi = styled(Card)`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(1)};

  > span { color: ${({ theme }) => theme.color.textSoft}; }
  strong {
    font-size: ${({ theme }) => theme.font.size.h1};
    color: ${({ theme }) => theme.color.textStrong};
  }
`;

const KpiNote = styled.small<{ $pending: boolean }>`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme, $pending }) => ($pending ? theme.color.cautionInk : theme.color.textSoft)};
  font-weight: ${({ theme, $pending }) => ($pending ? theme.font.weight.semibold : theme.font.weight.regular)};
  a { font-weight: ${({ theme }) => theme.font.weight.semibold}; }
`;

function deliveriesNote(total: number, pending: number) {
  if (total === 0) return 'Nenhuma entrega para hoje';
  if (pending === 0) return 'Todas já estão nos caminhões';
  return pending === 1 ? '1 aguardando carregamento' : `${pending} aguardando carregamento`;
}

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.space(2)};
`;

const MapCard = styled(Card)`
  flex: 2 1 520px;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const ListCard = styled(Card)`
  flex: 1 1 300px;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(1)};
`;

const VehicleRow = styled.button<{ $selected: boolean }>`
  all: unset;
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space(2)};
  padding: 12px 8px;
  margin: 0 -8px;
  border-radius: ${({ theme }) => theme.radius};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme, $selected }) => ($selected ? theme.color.primaryTint : 'transparent')};
  cursor: pointer;
  &:hover { background: ${({ theme, $selected }) => ($selected ? theme.color.primaryTint : theme.color.background)}; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; }

  div { flex-grow: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  strong { font-size: ${({ theme }) => theme.font.size.md}; }
  small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const SilentRow = styled.div`
  padding: 12px 0;
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  > div { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  strong { font-size: ${({ theme }) => theme.font.size.md}; }
  small { display: block; font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  ${Button} { height: 36px; padding: 0 12px; }
`;

const MapHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: ${({ theme }) => theme.space(1)};
`;

const Segmented = styled.div`
  display: inline-flex;
  padding: 3px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.background};
  border: 1px solid ${({ theme }) => theme.color.border};

  button {
    all: unset;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: ${({ theme }) => theme.font.size.md};
    font-weight: ${({ theme }) => theme.font.weight.semibold};
    color: ${({ theme }) => theme.color.textSoft};
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    background: ${({ theme }) => theme.color.surface};
    color: ${({ theme }) => theme.color.primary};
    box-shadow: ${({ theme }) => theme.shadow.soft};
  }
  button:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; }
`;

const Legend = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textSoft};

  li { display: inline-flex; align-items: center; gap: 6px; }
  strong { color: ${({ theme }) => theme.color.text}; }
`;

const Swatch = styled.span<{ $color: string; $dashed?: boolean }>`
  width: 22px;
  height: 0;
  border-top: 4px ${({ $dashed }) => ($dashed ? 'dashed' : 'solid')} ${({ $color }) => $color};
  opacity: ${({ $dashed }) => ($dashed ? 0.6 : 1)};
`;

const Dot = styled.span<{ $tone: 'success' | 'danger' | 'primary' }>`
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px ${({ theme }) => theme.color.border};
  background: ${({ theme, $tone }) => theme.color[$tone]};
`;

type MapMode = 'drivers' | 'trails';
const MODE_KEY = 'frotagest.mapMode';

function savedMode(): MapMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'trails' ? 'trails' : 'drivers';
  } catch {
    return 'drivers';
  }
}

function TrailLegend({ trails }: { trails: VehicleTrail[] }) {
  if (!trails.length) return <Muted style={{ fontSize: 12 }}>Nenhum veículo andou hoje ainda.</Muted>;
  return (
    <Legend aria-label="Legenda do caminho percorrido">
      {trails.map((t) => (
        <li key={t.vehicle_id}>
          <Swatch $color={trailColor(t.vehicle_id, trails)} />
          <span><strong>{t.plate}</strong> · {t.driver_name ?? 'sem motorista'} · {fmtKm(t.distance_km)} hoje</span>
        </li>
      ))}
      <li><Swatch $color="#7a7a7a" $dashed /> rota planejada</li>
      <li><Dot $tone="success" /> entregue</li>
      <li><Dot $tone="danger" /> não recebeu</li>
      <li><Dot $tone="primary" /> próxima</li>
    </Legend>
  );
}

const PROVIDER_LABEL: Record<Vehicle['tracker_provider'], string> = { sascar: 'Sascar', onixsat: 'Onixsat', mock: 'Simulador' };

/** Veículo cadastrado que ainda não mandou posição: dá para perguntar ao rastreador na hora. */
function SilentVehicle({ vehicle, driverName }: { vehicle: Vehicle; driverName?: string }) {
  const check = useTrackerCheck();
  return (
    <SilentRow>
      <div>
        <span>
          <strong>{vehicle.plate}</strong>
          <small>{driverName ?? 'Sem motorista'} · {PROVIDER_LABEL[vehicle.tracker_provider]} {vehicle.tracker_external_id} · sem posição ainda</small>
        </span>
        <Button type="button" $variant="secondary" disabled={check.isPending} onClick={() => check.mutate(vehicle.id)}>
          {check.isPending ? 'Verificando…' : 'Verificar rastreador'}
        </Button>
      </div>
      <TrackerCheckResult result={check.data} error={check.error} />
    </SilentRow>
  );
}

const tone: Record<LiveStatus, 'success' | 'neutral' | 'warning'> = {
  moving: 'success',
  stopped: 'neutral',
  offline: 'neutral',
  speeding: 'warning',
  at_base: 'neutral',
};

export function DashboardPage() {
  const summary = useSummary();
  const live = useLivePositions();
  const base = useCompanyBase();
  const vehicles = useVehicles();
  const drivers = useDrivers();
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setModeState] = useState<MapMode>(savedMode);
  const trails = useTrails(mode === 'trails');
  const s = summary.data;
  const positions = live.data ?? [];
  const focus = positions.find((p) => p.vehicle_id === selected);
  const focusPoint: LatLng | null = focus ? [focus.latitude, focus.longitude] : null;
  const setMode = (next: MapMode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // sem armazenamento (janela anônima): vale só nesta visita
    }
  };

  // Caminhos visíveis: todos, ou só o do veículo selecionado
  const allTrails = mode === 'trails' ? trails.data ?? [] : [];
  const shownTrails = selected ? allTrails.filter((t) => t.vehicle_id === selected) : allTrails;
  const baseCoord: LatLng[] = base.data ? [[base.data.latitude, base.data.longitude]] : [];
  // A rota inteira à vista: o que já andou, o traçado planejado e as paradas
  const trailFit: LatLng[] = shownTrails.flatMap((t) => [
    ...t.points,
    ...(t.run?.status === 'active' ? t.run.geometry : []),
    ...(t.run?.stops.map((p) => [p.latitude, p.longitude] as LatLng) ?? []),
  ]);
  const fit: LatLng[] =
    mode === 'trails' && trailFit.length
      ? [...trailFit, ...(selected ? [] : baseCoord)]
      : focusPoint
        ? [focusPoint]
        : [...positions.map((p) => [p.latitude, p.longitude] as LatLng), ...baseCoord];
  // Reenquadra ao trocar de modo, de veículo ou quando aparece um veículo/caminho novo, não a cada posição
  const fitKey = [mode, selected ?? 'todos', mode === 'trails' ? shownTrails.map((t) => `${t.vehicle_id}:${t.run?.id ?? ''}`).join(',') : positions.map((p) => p.vehicle_id).join(','), Boolean(base.data)].join('|');
  const silent = (vehicles.data ?? []).filter((v) => !positions.some((p) => p.vehicle_id === v.id));
  const driverName = (id: number | null) => drivers.data?.find((d) => d.id === id)?.name;
  const select = (p: LivePosition) => setSelected((current) => (current === p.vehicle_id ? null : p.vehicle_id));

  return (
    <>
      <PageHeader>
        <div>
          <h1>Painel da frota</h1>
          <Muted>As posições atualizam sozinhas (na hora, com o rastreador simulado; a cada 30 s, com os de verdade).</Muted>
        </div>
      </PageHeader>

      <Kpis>
        <Kpi>
          <span>Veículos em rota</span>
          <strong>{s ? `${s.vehicles_moving} / ${s.vehicles_total}` : '–'}</strong>
        </Kpi>
        <Kpi>
          <span>Km rodados hoje</span>
          <strong>{s ? fmtKm(s.km_today) : '–'}</strong>
        </Kpi>
        <Kpi>
          <span>Entregas carregadas hoje</span>
          <strong>{s ? `${s.deliveries_today - s.deliveries_pending} / ${s.deliveries_today}` : '–'}</strong>
          {s && (
            <KpiNote $pending={s.deliveries_pending > 0}>
              {deliveriesNote(s.deliveries_today, s.deliveries_pending)} · <Link to="/carregamento">Abrir carregamento</Link>
            </KpiNote>
          )}
        </Kpi>
      </Kpis>

      <Row>
        <MapCard aria-label="Mapa ao vivo">
          <MapHead>
            <CardTitle>Mapa ao vivo</CardTitle>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <Segmented role="group" aria-label="O que mostrar no mapa">
                <button type="button" aria-pressed={mode === 'drivers'} onClick={() => setMode('drivers')}>Só motoristas</button>
                <button type="button" aria-pressed={mode === 'trails'} onClick={() => setMode('trails')}>Caminho percorrido</button>
              </Segmented>
              {focus && (
                <Button type="button" $variant="secondary" style={{ height: 36 }} onClick={() => setSelected(null)}>Ver todos</Button>
              )}
            </div>
          </MapHead>
          <FleetMap
            vehicles={selected && mode === 'trails' ? positions.filter((p) => p.vehicle_id === selected) : positions}
            base={base.data}
            trails={shownTrails}
            fit={fit}
            fitKey={fitKey}
            follow={mode === 'drivers' ? focusPoint : null}
            selectedVehicleId={selected}
            onSelectVehicle={(id) => setSelected(id)}
          />
          {mode === 'trails' && trails.isSuccess && <TrailLegend trails={shownTrails} />}
          {base.data === null && (
            <Muted>
              <Link to="/configuracoes">Defina a base da empresa</Link> para ver no mapa de onde os caminhões saem e
              separar as rotas em viagens.
            </Muted>
          )}
        </MapCard>
        <ListCard aria-label="Veículos">
          <CardTitle>Veículos</CardTitle>
          {live.isLoading && <Muted>Carregando posições…</Muted>}
          {live.isSuccess && positions.length === 0 && silent.length === 0 && (
            <Muted>Nenhum veículo cadastrado ainda.</Muted>
          )}
          {positions.length > 0 && <Muted style={{ fontSize: 12 }}>Clique num veículo para vê-lo no mapa.</Muted>}
          {positions.map((v) => (
            <VehicleRow
              key={v.vehicle_id}
              type="button"
              $selected={v.vehicle_id === selected}
              aria-pressed={v.vehicle_id === selected}
              onClick={() => select(v)}
            >
              <div>
                <strong>{v.plate}</strong>
                <small>
                  {v.driver_name ?? 'Sem motorista'} · {Math.round(v.speed_kmh)} km/h · {fmtTime(v.recorded_at)}
                </small>
              </div>
              <Pill $tone={tone[v.status]}>{statusLabel[v.status]}</Pill>
            </VehicleRow>
          ))}
          {silent.map((v) => <SilentVehicle key={v.id} vehicle={v} driverName={driverName(v.current_driver_id)} />)}
        </ListCard>
      </Row>
    </>
  );
}
