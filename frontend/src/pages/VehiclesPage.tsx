import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import {
  useCreateVehicle,
  useDeleteVehicle,
  useDrivers,
  useLivePositions,
  useTires,
  useTrackerCheck,
  useUpdateVehicle,
  useVehicleUsage,
  useVehicles,
} from '../api/queries';
import type { Driver, LivePosition, Vehicle, VehicleDeletion } from '../api/types';
import { Dialog } from '../components/Dialog';
import { statusLabel } from '../components/FleetMap';
import { Icon } from '../components/Icon';
import { TireToneBadge } from '../components/Tires';
import { TrackerCheckResult } from '../components/TrackerCheckResult';
import {
  Button,
  Card,
  ErrorText,
  FieldLabel,
  FormActions,
  FormGrid,
  FormSection,
  Input,
  Muted,
  PageHeader,
  Pill,
  Select,
  SrOnly,
  SuccessText,
  Table,
  TableScroll,
} from '../components/ui';
import { emptyVehicleForm, formToVehicle, FUEL_LABEL, VehicleFields, vehicleToForm } from '../components/VehicleFields';
import { fmtKg, fmtTime } from '../format';
import { VehicleTiresTab } from './TiresPage';

const PROVIDER_LABEL: Record<Vehicle['tracker_provider'], string> = { sascar: 'Sascar', onixsat: 'Onixsat', mock: 'Simulador' };

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const Hint = styled(Muted)`
  margin-top: ${({ theme }) => theme.space(1)};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

const Cell = styled.td`
  strong { display: block; color: ${({ theme }) => theme.color.textStrong}; }
  small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  ${Button} { height: 36px; padding: 0 12px; }
`;

const SignalCell = styled.td`
  min-width: 170px;
  ${Button} { height: 32px; padding: 0 10px; margin-top: 4px; }
`;

interface FormProps {
  vehicle: Vehicle | null;
  vehicles: Vehicle[];
  drivers: Driver[];
  onCancel: () => void;
  onSaved: (message: string) => void;
}

/** Cadastro e edição do veículo pelo gestor, inclusive o motorista que dirige. */
function VehicleForm({ vehicle, vehicles, drivers, onCancel, onSaved }: FormProps) {
  const update = useUpdateVehicle();
  const create = useCreateVehicle();
  const [form, setForm] = useState(() => (vehicle ? vehicleToForm(vehicle) : emptyVehicleForm));
  const [driverId, setDriverId] = useState(vehicle?.current_driver_id ? String(vehicle.current_driver_id) : '');
  const saving = update.isPending || create.isPending;
  const error = update.error ?? create.error;

  const active = drivers.filter((d) => d.active);
  const nameOf = (id: number | null) => drivers.find((d) => d.id === id)?.name;
  const vehicleOf = (driver: number) => vehicles.find((v) => v.current_driver_id === driver && v.id !== vehicle?.id);
  const chosen = driverId ? Number(driverId) : null;
  const leaving = chosen ? vehicleOf(chosen) : undefined;
  const previous = vehicle?.current_driver_id && vehicle.current_driver_id !== chosen ? nameOf(vehicle.current_driver_id) : undefined;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = { ...formToVehicle(form), current_driver_id: chosen };
    const done = (saved: Vehicle) => onSaved(vehicle ? `Veículo ${saved.plate} atualizado.` : `Veículo ${saved.plate} cadastrado.`);
    if (vehicle) update.mutate({ id: vehicle.id, ...body }, { onSuccess: done });
    else create.mutate(body, { onSuccess: done });
  }

  return (
    <form onSubmit={onSubmit}>
      <FormSection>
        <legend>Dados do veículo</legend>
        <FormGrid>
          <VehicleFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        </FormGrid>
        {vehicle && (form.tracker_provider !== vehicle.tracker_provider || form.tracker_external_id.trim() !== vehicle.tracker_external_id) && (
          <Hint>Mudando o rastreador ou o código, as próximas posições passam a vir do novo. As antigas continuam no histórico.</Hint>
        )}
      </FormSection>

      <FormSection>
        <legend>Motorista</legend>
        <FormGrid>
          <FieldLabel>
            Quem dirige este veículo
            <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Sem motorista</option>
              {active.map((d) => {
                const other = vehicleOf(d.id);
                return <option key={d.id} value={d.id}>{d.name}{other ? ` (hoje com ${other.plate})` : ''}</option>;
              })}
            </Select>
          </FieldLabel>
        </FormGrid>
        {leaving && <Hint>{nameOf(chosen)} deixa o veículo {leaving.plate}, que fica sem motorista.</Hint>}
        {previous && <Hint>{previous} fica sem veículo.</Hint>}
      </FormSection>

      <Stack>
        {error && <ErrorText role="alert">{errorMessage(error)}</ErrorText>}
        <FormActions>
          <Button type="button" $variant="secondary" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Salvando…' : vehicle ? 'Salvar alterações' : 'Cadastrar veículo'}</Button>
        </FormActions>
      </Stack>
    </form>
  );
}

/** Sinal do rastreador: hora da última posição ou o botão para perguntar ao rastreador. */
function Signal({ vehicle, position }: { vehicle: Vehicle; position: LivePosition | undefined }) {
  const check = useTrackerCheck();
  if (position) {
    return (
      <SignalCell>
        <Pill $tone={position.status === 'offline' ? 'neutral' : 'success'}>{statusLabel[position.status]}</Pill>
        <br />
        <small>última posição {fmtTime(position.recorded_at)}</small>
      </SignalCell>
    );
  }
  return (
    <SignalCell>
      <Pill $tone="neutral">Sem posição</Pill>
      <br />
      <Button type="button" $variant="secondary" disabled={check.isPending} onClick={() => check.mutate(vehicle.id)} aria-label={`Verificar rastreador de ${vehicle.plate}`}>
        {check.isPending ? 'Verificando…' : 'Verificar'}
      </Button>
      <TrackerCheckResult result={check.data} error={check.error} />
    </SignalCell>
  );
}

const Note = styled.p`
  margin: 0;
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.neutralTint};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

const Consequences = styled.ul`
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

function deletionText(d: VehicleDeletion) {
  const parts = [`Veículo ${d.plate} excluído.`];
  const gone = [
    d.positions && `${d.positions.toLocaleString('pt-BR')} posições do rastreador`,
    d.runs && `${d.runs} ${d.runs === 1 ? 'rota' : 'rotas'}`,
    d.tires && `${d.tires} ${d.tires === 1 ? 'pneu' : 'pneus'}`,
  ].filter(Boolean);
  if (gone.length) parts.push(`Também saíram: ${gone.join(', ')}.`);
  return parts.join(' ');
}

/** Confirmação da exclusão: mostra o que vai junto e pede a placa quando há histórico. */
function DeleteVehicleDialog({ vehicle, onClose, onDeleted }: { vehicle: Vehicle | null; onClose: () => void; onDeleted: (d: VehicleDeletion) => void }) {
  const usage = useVehicleUsage(vehicle?.id ?? null);
  const remove = useDeleteVehicle();
  const [typed, setTyped] = useState('');
  useEffect(() => {
    setTyped('');
    remove.reset();
  }, [vehicle?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const u = usage.data;
  const hasHistory = Boolean(u && (u.positions || u.runs || u.tires));
  const confirmed = !hasHistory || typed.replace(/[^A-Z0-9]/gi, '').toUpperCase() === vehicle?.plate;
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (vehicle && confirmed) remove.mutate(vehicle.id, { onSuccess: onDeleted });
  }

  return (
    <Dialog open={Boolean(vehicle)} size="small" title={vehicle ? `Excluir ${vehicle.plate}?` : 'Excluir veículo'} onClose={onClose}>
      {vehicle && (
        <form onSubmit={onSubmit}>
          <Stack>
            {usage.isLoading && <Muted>Conferindo o histórico do veículo…</Muted>}
            {u && (
              <>
                <Muted>O veículo sai da frota{hasHistory ? ', junto com:' : '. Ele não tem histórico, nada mais é apagado.'}</Muted>
                {hasHistory && (
                  <Consequences>
                    {u.positions > 0 && <li>{u.positions.toLocaleString('pt-BR')} posições do rastreador (o trajeto dele no mapa e nas rotas).</li>}
                    {u.runs > 0 && <li>{u.runs} {u.runs === 1 ? 'rota de entrega feita' : 'rotas de entrega feitas'} com ele, com os km (saem dos custos).</li>}
                    {u.tires > 0 && <li>{u.tires} {u.tires === 1 ? 'pneu' : 'pneus'} com o histórico de medições, rodízios e recapagens.</li>}
                  </Consequences>
                )}
                {u.driver_name && <Note>{u.driver_name} fica sem veículo. As entregas dele não mudam.</Note>}
                {u.active_run && <ErrorText role="alert">O veículo está numa rota em andamento. Encerre a rota antes de excluir.</ErrorText>}
                {hasHistory && !u.active_run && (
                  <FieldLabel>
                    Para confirmar, digite a placa: {vehicle.plate}
                    <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
                  </FieldLabel>
                )}
              </>
            )}
            {remove.isError && <ErrorText role="alert">{errorMessage(remove.error)}</ErrorText>}
            <FormActions>
              <Button type="button" $variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={!u || u.active_run || !confirmed || remove.isPending}>
                {remove.isPending ? 'Excluindo…' : 'Excluir veículo'}
              </Button>
            </FormActions>
          </Stack>
        </form>
      )}
    </Dialog>
  );
}

const Tabs = styled.div`
  display: flex;
  gap: 4px;
  margin-bottom: ${({ theme }) => theme.space(2)};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
`;

const Tab = styled.button<{ $active: boolean }>`
  all: unset;
  cursor: pointer;
  padding: 10px 16px;
  margin-bottom: -1px;
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme, $active }) => ($active ? theme.color.primary : theme.color.textSoft)};
  border-bottom: 3px solid ${({ theme, $active }) => ($active ? theme.color.primary : 'transparent')};
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; }
`;

const TireLink = styled.button`
  all: unset;
  cursor: pointer;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: ${({ theme }) => theme.color.primary};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; }
`;

/** Gestor: veículos da frota (edição completa, troca de motorista, exclusão) e, numa aba, os pneus de cada um. */
export function VehiclesPage() {
  const vehicles = useVehicles();
  const drivers = useDrivers();
  const live = useLivePositions();
  const tires = useTires();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Vehicle | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Vehicle | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const list = vehicles.data ?? [];
  const nameOf = (id: number | null) => drivers.data?.find((d) => d.id === id)?.name;
  const tab = params.get('aba') === 'pneus' ? 'tires' : 'list';
  const tiresVehicle = params.get('veiculo') ? Number(params.get('veiculo')) : null;
  const openTires = (id: number | null) => setParams(id ? { aba: 'pneus', veiculo: String(id) } : { aba: 'pneus' });
  const tiresOf = (id: number) => (tires.data ?? []).filter((t) => t.vehicle_id === id);

  // Link vindo de outra tela: /veiculos?editar=ID abre a edição
  useEffect(() => {
    const id = params.get('editar');
    const target = id ? list.find((v) => String(v.id) === id) : undefined;
    if (target) {
      setEditing(target);
      setParams({}, { replace: true });
    }
  }, [params, list, setParams]);

  const close = () => setEditing(null);

  return (
    <>
      <PageHeader>
        <div style={{ flexGrow: 1 }}>
          <h1>Veículos</h1>
          <Muted>Placa, rastreador, consumo e motorista de cada veículo da frota.</Muted>
        </div>
        {tab === 'list' && (
          <Button type="button" onClick={() => { setNotice(null); setEditing('new'); }}>
            <Icon name="plus" size={20} />
            Novo veículo
          </Button>
        )}
      </PageHeader>

      <Tabs role="tablist" aria-label="Veículos">
        <Tab type="button" role="tab" aria-selected={tab === 'list'} $active={tab === 'list'} onClick={() => setParams({})}>Veículos</Tab>
        <Tab type="button" role="tab" aria-selected={tab === 'tires'} $active={tab === 'tires'} onClick={() => openTires(tiresVehicle)}>Pneus</Tab>
      </Tabs>

      {tab === 'tires' && <VehicleTiresTab vehicleId={tiresVehicle} onChangeVehicle={(id) => openTires(id)} />}

      {tab === 'list' && (
        <Stack>
          {notice && <SuccessText role="status">{notice}</SuccessText>}
          <Card>
            {vehicles.isLoading && <Muted>Carregando veículos…</Muted>}
            {vehicles.isSuccess && list.length === 0 && <Muted>Nenhum veículo ainda. Use “Novo veículo” para cadastrar.</Muted>}
            {list.length > 0 && (
              <TableScroll>
                <Table style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>Veículo</th>
                      <th>Motorista</th>
                      <th>Rastreador</th>
                      <th>Combustível</th>
                      <th>Capacidade</th>
                      <th>Pneus</th>
                      <th>Sinal</th>
                      <th><SrOnly>Ações</SrOnly></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((v) => (
                      <tr key={v.id}>
                        <Cell><strong>{v.plate}</strong>{v.model && <small>{v.model}</small>}</Cell>
                        <td>{nameOf(v.current_driver_id) ?? <Pill $tone="neutral">Sem motorista</Pill>}</td>
                        <Cell><strong>{PROVIDER_LABEL[v.tracker_provider]}</strong><small>código {v.tracker_external_id}</small></Cell>
                        <td>
                          {v.fuel_type ? FUEL_LABEL[v.fuel_type] : '–'}
                          {v.km_per_liter ? ` · ${v.km_per_liter.toLocaleString('pt-BR')} km/l` : ''}
                        </td>
                        <td>{v.capacity_kg ? fmtKg(v.capacity_kg) : '–'}</td>
                        <td>
                          <TireLink type="button" onClick={() => openTires(v.id)} aria-label={`Pneus de ${v.plate}`}>
                            {tiresOf(v.id).length > 0 && (
                              <TireToneBadge wear={Math.max(...tiresOf(v.id).filter((t) => t.in_use).map((t) => t.wear_pct), 0)} />
                            )}
                            {tiresOf(v.id).length ? `${tiresOf(v.id).length} ${tiresOf(v.id).length === 1 ? 'pneu' : 'pneus'}` : 'Cadastrar'}
                          </TireLink>
                        </td>
                        <Signal vehicle={v} position={live.data?.find((p) => p.vehicle_id === v.id)} />
                        <td>
                          <Actions>
                            <Button type="button" $variant="secondary" onClick={() => { setNotice(null); setEditing(v); }} aria-label={`Editar ${v.plate}`}>
                              <Icon name="edit" size={16} />
                              Editar
                            </Button>
                            <Button type="button" $variant="secondary" onClick={() => { setNotice(null); setDeleting(v); }} aria-label={`Excluir ${v.plate}`}>
                              <Icon name="trash" size={16} />
                              Excluir
                            </Button>
                          </Actions>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </Card>
        </Stack>
      )}

      <DeleteVehicleDialog
        vehicle={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(d) => {
          setDeleting(null);
          setNotice(deletionText(d));
        }}
      />

      <Dialog open={editing !== null} title={editing === 'new' ? 'Novo veículo' : editing ? `Editar ${editing.plate}` : 'Veículo'} onClose={close}>
        {editing !== null && (
          <VehicleForm
            key={editing === 'new' ? 'new' : editing.id}
            vehicle={editing === 'new' ? null : editing}
            vehicles={list}
            drivers={drivers.data ?? []}
            onCancel={close}
            onSaved={(message) => {
              close();
              setNotice(message);
            }}
          />
        )}
      </Dialog>
    </>
  );
}
