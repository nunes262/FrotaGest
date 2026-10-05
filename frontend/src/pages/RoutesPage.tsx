import { useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useCompanyBase, useDrivers, useRouteDetail, useRoutes, useVehicles, type RouteFilters } from '../api/queries';
import type { RouteSummary, Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { FleetMap } from '../components/FleetMap';
import { Card, CardTitle, FieldLabel, Input, Muted, PageHeader, Pill, Select, Table, TableScroll } from '../components/ui';
import { fmtDay, fmtDuration, fmtKm, fmtTime, todayISO } from '../format';

const Filters = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.space(2)};
`;

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const RowButton = styled.button<{ $selected: boolean }>`
  all: unset;
  cursor: pointer;
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme, $selected }) => ($selected ? theme.color.primary : theme.color.textStrong)};
  text-decoration: ${({ $selected }) => ($selected ? 'underline' : 'none')};
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; }
`;

const Totals = styled.p`
  margin: 0;
  font-size: ${({ theme }) => theme.font.size.md};
  strong { color: ${({ theme }) => theme.color.textStrong}; }
`;

const Trips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.space(1)};
`;

const TripButton = styled.button<{ $active: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 12px;
  border-radius: ${({ theme }) => theme.radius};
  border: 1.5px solid ${({ theme, $active }) => ($active ? theme.color.primary : theme.color.border)};
  background: ${({ theme, $active }) => ($active ? theme.color.primaryTint : theme.color.surface)};
  cursor: pointer;
  text-align: left;
  transition: background 150ms ease, border-color 150ms ease;

  strong { font-size: ${({ theme }) => theme.font.size.md}; color: ${({ theme, $active }) => ($active ? theme.color.primary : theme.color.textStrong)}; }
  span { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const key = (r: RouteSummary) => `${r.day}-${r.vehicle_id}-${r.driver_id}`;

function tripText(t: Trip, baseName: string) {
  const out = t.left_base ? `Saiu do ${baseName} às ${fmtTime(t.left_at)}` : `Já estava fora às ${fmtTime(t.left_at)}`;
  const back = t.returned_at ? `voltou às ${fmtTime(t.returned_at)}` : 'ainda fora';
  return `${out} · ${back} · ${fmtKm(t.distance_km)}`;
}

export function RoutesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [filters, setFilters] = useState<RouteFilters>({ date_from: todayISO(-6), date_to: todayISO() });
  const [selected, setSelected] = useState<RouteSummary | null>(null);
  const [tripIndex, setTripIndex] = useState<number | null>(null);

  const routes = useRoutes(filters);
  const drivers = useDrivers(isAdmin);
  const vehicles = useVehicles();
  const detail = useRouteDetail(selected?.vehicle_id, selected?.day);
  const base = useCompanyBase();

  const update = (patch: Partial<RouteFilters>) => {
    setSelected(null);
    setFilters((f) => ({ ...f, ...patch }));
  };
  const selectRoute = (r: RouteSummary) => {
    setSelected(r);
    setTripIndex(null);
  };

  const points = detail.data?.points ?? [];
  const trips = detail.data?.trips ?? [];
  const trip = tripIndex !== null ? trips[tripIndex] : undefined;
  const highlight = trip ? points.slice(trip.start_index, trip.end_index + 1) : [];

  const totalKm = routes.data?.reduce((s, r) => s + r.distance_km, 0) ?? 0;
  const totalMin = routes.data?.reduce((s, r) => s + r.driving_minutes, 0) ?? 0;

  return (
    <>
      <PageHeader>
        <h1>{isAdmin ? 'Rotas por motorista' : 'Minhas rotas'}</h1>
        <Filters>
          <FieldLabel>
            De
            <Input type="date" value={filters.date_from} max={filters.date_to} onChange={(e) => update({ date_from: e.target.value })} />
          </FieldLabel>
          <FieldLabel>
            Até
            <Input type="date" value={filters.date_to} min={filters.date_from} onChange={(e) => update({ date_to: e.target.value })} />
          </FieldLabel>
          {isAdmin && (
            <FieldLabel>
              Motorista
              <Select
                value={filters.driver_id ?? ''}
                onChange={(e) => update({ driver_id: e.target.value ? Number(e.target.value) : undefined })}
              >
                <option value="">Todos os motoristas</option>
                {drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.name}{d.active ? '' : ' (removido)'}</option>)}
              </Select>
            </FieldLabel>
          )}
          <FieldLabel>
            Veículo
            <Select
              value={filters.vehicle_id ?? ''}
              onChange={(e) => update({ vehicle_id: e.target.value ? Number(e.target.value) : undefined })}
            >
              <option value="">Todos</option>
              {vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
            </Select>
          </FieldLabel>
        </Filters>
      </PageHeader>

      <Stack>
        <Card>
          <Stack>
            <CardTitle>{selected ? `Trajeto de ${selected.plate} em ${fmtDay(selected.day)}` : 'Trajeto'}</CardTitle>
            {!selected && <Muted>Escolha uma rota na tabela para ver o trajeto no mapa.</Muted>}
            {selected && base.data && detail.isSuccess && (
              trips.length === 0 ? (
                <Muted>Nenhuma saída do {base.data.name} neste dia.</Muted>
              ) : (
                <Trips role="group" aria-label="Viagens do dia">
                  <TripButton type="button" $active={tripIndex === null} aria-pressed={tripIndex === null} onClick={() => setTripIndex(null)}>
                    <strong>Dia inteiro</strong>
                    <span>{trips.length === 1 ? '1 viagem' : `${trips.length} viagens`}</span>
                  </TripButton>
                  {trips.map((t, i) => (
                    <TripButton key={t.start_index} type="button" $active={tripIndex === i} aria-pressed={tripIndex === i} onClick={() => setTripIndex(i)}>
                      <strong>Viagem {i + 1}</strong>
                      <span>{tripText(t, base.data!.name)}</span>
                    </TripButton>
                  ))}
                </Trips>
              )
            )}
            {selected && base.data === null && isAdmin && (
              <Muted>
                <Link to="/configuracoes">Defina a base da empresa</Link> para dividir o dia em viagens (saída e volta da base).
              </Muted>
            )}
            {selected && <FleetMap route={points} highlight={highlight} base={base.data} />}
          </Stack>
        </Card>

        <Card>
          <Stack>
            <Totals>
              <strong>{fmtKm(totalKm)}</strong> rodados e <strong>{fmtDuration(totalMin)}</strong> de direção no período
            </Totals>
            {routes.isLoading && <Muted>Carregando rotas…</Muted>}
            {routes.data?.length === 0 && <Muted>Nenhuma rota no período. Ajuste as datas ou os filtros.</Muted>}
            {!!routes.data?.length && (
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <th>Dia</th>
                      <th>Motorista</th>
                      <th>Veículo</th>
                      <th>Horário</th>
                      <th>Km</th>
                      <th>Direção</th>
                      <th>Vel. máxima</th>
                      <th>Excessos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routes.data.map((r) => (
                      <tr key={key(r)}>
                        <td>
                          <RowButton type="button" $selected={selected ? key(selected) === key(r) : false} onClick={() => selectRoute(r)}>
                            {fmtDay(r.day)}
                          </RowButton>
                        </td>
                        <td>{r.driver_name ?? 'Sem motorista'}</td>
                        <td>{r.plate}</td>
                        <td>{fmtTime(r.started_at)} – {fmtTime(r.ended_at)}</td>
                        <td>{fmtKm(r.distance_km)}</td>
                        <td>{fmtDuration(r.driving_minutes)}</td>
                        <td>{Math.round(r.max_speed_kmh)} km/h</td>
                        <td>
                          {r.speeding_events > 0
                            ? <Pill $tone="warning">{r.speeding_events}</Pill>
                            : <Pill $tone="success">Nenhum</Pill>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </Stack>
        </Card>
      </Stack>
    </>
  );
}
