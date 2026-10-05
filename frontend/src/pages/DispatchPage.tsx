import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import {
  useAssignDeliveries,
  useCreateDelivery,
  useDeleteDelivery,
  useDeliveries,
  useDrivers,
  useRegionEstimates,
  useRuns,
  useVehicles,
} from '../api/queries';
import type { Delivery, Driver, RegionEstimate, RunSummary, Vehicle } from '../api/types';
import { CityInput, StreetInput, type CityValue } from '../components/AddressInputs';
import { ChecklistBadge, ChecklistView } from '../components/Checklist';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { LoadMeter, onBoardKg, sumKg } from '../components/LoadMeter';
import { ProofView, REASON_LABEL } from '../components/Proof';
import {
  Button,
  Card,
  CardTitle,
  ErrorText,
  FieldLabel,
  FormActions,
  FormGrid,
  IconButton,
  Input,
  Muted,
  PageHeader,
  Pill,
} from '../components/ui';
import { fmtBRL, fmtKg, fmtKm, fmtTime, plural, todayISO } from '../format';

const Totals = styled.p`
  margin: 0 0 ${({ theme }) => theme.space(2)};
  font-size: ${({ theme }) => theme.font.size.md};
  strong { color: ${({ theme }) => theme.color.textStrong}; }
`;

const Columns = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: ${({ theme }) => theme.space(2)};
`;

const Queue = styled(Card)`
  flex: 1 1 340px;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(1)};
`;

const QueueHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space(1)};
  margin-bottom: ${({ theme }) => theme.space(1)};
`;

const checkbox = `
  input[type='checkbox'] {
    width: 20px;
    height: 20px;
    margin: 0;
    flex-shrink: 0;
    cursor: pointer;
  }
`;

const SelectAll = styled.label`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.textSoft};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  cursor: pointer;
  ${checkbox}
  input[type='checkbox'] { accent-color: ${({ theme }) => theme.color.primary}; }
`;

const QueueRow = styled.div<{ $checked: boolean }>`
  display: flex;
  align-items: center;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme, $checked }) => ($checked ? theme.color.primaryTint : 'transparent')};
  transition: background 150ms ease;

  label {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 8px;
    cursor: pointer;
  }
  ${checkbox}
  input[type='checkbox'] { accent-color: ${({ theme }) => theme.color.primary}; }
`;

const Info = styled.span`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;

  strong {
    color: ${({ theme }) => theme.color.textStrong};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const Weight = styled.span`
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  white-space: nowrap;
`;

const OrderBadge = styled.span`
  min-width: 32px;
  height: 24px;
  padding: 0 6px;
  border-radius: 12px;
  background: ${({ theme }) => theme.color.primary};
  color: ${({ theme }) => theme.color.textInvert};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  display: grid;
  place-items: center;
`;

const QueueFooter = styled.p`
  margin: ${({ theme }) => theme.space(1)} 0 0;
  padding-top: ${({ theme }) => theme.space(2)};
  border-top: 1px solid ${({ theme }) => theme.color.border};
  font-size: ${({ theme }) => theme.font.size.md};
  strong { color: ${({ theme }) => theme.color.textStrong}; }
`;

const Trucks = styled.div`
  flex: 2 1 560px;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: ${({ theme }) => theme.space(2)};
`;

const Truck = styled(Card)`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};

  > header { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
  > header strong { font-size: ${({ theme }) => theme.font.size.lg}; color: ${({ theme }) => theme.color.textStrong}; }
  > header small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  > ${Button} { margin-top: auto; }
`;

const Stops = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 0;
    border-bottom: 1px solid ${({ theme }) => theme.color.border};
  }
  li:last-child { border-bottom: 0; }
`;

const StopNumber = styled.span`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${({ theme }) => theme.color.neutralTint};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  display: grid;
  place-items: center;
`;

interface TruckCardProps {
  driver: Driver;
  vehicle: Vehicle | undefined;
  /** Rotas do motorista neste dia, da primeira para a última (ele pode fazer mais de uma) */
  runs: RunSummary[];
  /** Região e preço previstos do que está no caminhão (antes de a rota começar) */
  estimate: RegionEstimate | undefined;
  stops: Delivery[];
  selectedCount: number;
  selectedKg: number;
  busy: boolean;
  onLoad: () => void;
  onUnload: (delivery: Delivery) => void;
  onViewProof: (delivery: Delivery) => void;
  onViewChecklist: (checklistId: number) => void;
}

const PAUSE_LABEL = { meal: 'refeição', rest: 'descanso', wait: 'espera' } as const;

const ProofButton = styled.button`
  all: unset;
  cursor: pointer;
  border-radius: 12px;
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; outline-offset: 2px; }
`;

const PreviousAttempt = styled.small`
  color: ${({ theme }) => theme.color.dangerInk} !important;
`;

function RoutePrice({ run, estimate }: { run: RunSummary | undefined; estimate: RegionEstimate | undefined }) {
  if (run?.status === 'active' && run.region_price !== null) {
    return <Muted style={{ fontSize: 12 }}>Rota: {run.region_name} · <strong>{fmtBRL(run.region_price)}</strong> pela tabela</Muted>;
  }
  if (estimate?.price != null) {
    return (
      <Muted style={{ fontSize: 12 }}>
        Rota prevista: {estimate.region_name} · <strong>{fmtBRL(estimate.price)}</strong> pela tabela
        {estimate.unplaced > 0 && ` (${plural(estimate.unplaced, 'endereço ainda sem região', 'endereços ainda sem região')})`}
      </Muted>
    );
  }
  return null;
}

const RunGroup = styled.details`
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius};
  padding: 8px 12px;

  summary {
    cursor: pointer;
    font-size: ${({ theme }) => theme.font.size.md};
    color: ${({ theme }) => theme.color.text};
  }
  summary strong { color: ${({ theme }) => theme.color.textStrong}; }
  ol { margin-top: 8px; }
`;

interface StopRowProps {
  d: Delivery;
  number?: number;
  busy: boolean;
  onUnload: (delivery: Delivery) => void;
  onViewProof: (delivery: Delivery) => void;
}

function StopRow({ d, number, busy, onUnload, onViewProof }: StopRowProps) {
  return (
    <li>
      {number !== undefined && <StopNumber aria-hidden="true">{number}</StopNumber>}
      <Info>
        <strong>{d.customer_name}</strong>
        <small>{d.city} · {fmtKg(d.weight_kg)}</small>
      </Info>
      {d.status === 'delivered' && (
        <ProofButton type="button" onClick={() => onViewProof(d)} aria-label={`Comprovante de ${d.customer_name}`}>
          <Pill $tone="success">Entregue{d.proof ? ` ${fmtTime(d.proof.created_at)}` : ''}</Pill>
        </ProofButton>
      )}
      {d.status === 'failed' && (
        <ProofButton type="button" onClick={() => onViewProof(d)} aria-label={`Ocorrência de ${d.customer_name}`}>
          <Pill $tone="danger">Não entregue</Pill>
        </ProofButton>
      )}
      {d.status !== 'delivered' && (
        <IconButton
          type="button"
          aria-label={d.status === 'failed' ? `Devolver ${d.customer_name} para a fila` : `Tirar ${d.customer_name} do caminhão`}
          title={d.status === 'failed' ? 'Devolver para a fila (nova tentativa)' : undefined}
          disabled={busy}
          onClick={() => onUnload(d)}
        >
          <Icon name="close" size={20} />
        </IconButton>
      )}
    </li>
  );
}

function TruckCard({ driver, vehicle, runs, estimate, stops, selectedCount, selectedKg, busy, onLoad, onUnload, onViewProof, onViewChecklist }: TruckCardProps) {
  const active = runs.find((r) => r.status === 'active');
  const finished = runs.filter((r) => r.status === 'finished');
  const finishedIds = new Set(finished.map((r) => r.id));
  // As entregas de rotas já encerradas ficam com a rota delas; as que ainda estão no caminhão são da rota atual ou da próxima
  const ofFinished = (d: Delivery) => d.run_id !== null && finishedIds.has(d.run_id) && !d.on_board;
  const current = stops.filter((d) => !ofFinished(d));
  const label = (r: RunSummary) => `Rota ${runs.indexOf(r) + 1}`;

  return (
    <Truck as="article" aria-label={`Caminhão de ${driver.name}`}>
      <header>
        <strong>{driver.name}</strong>
        {vehicle
          ? <small>{vehicle.plate}{vehicle.model ? ` · ${vehicle.model}` : ''}</small>
          : <Pill $tone="caution">Sem veículo vinculado</Pill>}
        {active && !active.active_pause && (
          <Pill $tone="success">{label(active)} em andamento desde {fmtTime(active.started_at)} · {fmtKm(active.distance_km)}</Pill>
        )}
        {active?.active_pause && (
          <Pill $tone="caution">Em pausa para {PAUSE_LABEL[active.active_pause.kind]} desde {fmtTime(active.active_pause.started_at)}</Pill>
        )}
        {active && <ChecklistBadge checklist={active.checklist} onOpen={onViewChecklist} />}
      </header>
      <LoadMeter loadedKg={onBoardKg(stops)} selectedKg={selectedKg} capacityKg={vehicle?.capacity_kg ?? null} />
      <RoutePrice run={active} estimate={estimate} />
      {finished.map((r) => {
        const items = stops.filter((d) => d.run_id === r.id && !d.on_board);
        const delivered = items.filter((d) => d.status === 'delivered').length;
        return (
          <RunGroup key={r.id}>
            <summary>
              <strong>{label(r)}</strong> · encerrada às {fmtTime(r.finished_at!)} · {delivered} de {plural(items.length, 'entrega', 'entregas')}
              {r.load_kg !== null && ` · ${fmtKg(r.load_kg)}`} · {fmtKm(r.distance_km)}
              {r.region_price !== null && ` · ${fmtBRL(r.region_price)}`}
              {r.checklist ? (r.checklist.issues ? ` · checklist com ${r.checklist.issues} ${r.checklist.issues === 1 ? 'pendência' : 'pendências'}` : ' · checklist OK') : ' · sem checklist'}
            </summary>
            {r.checklist && (
              <div style={{ marginTop: 8 }}><ChecklistBadge checklist={r.checklist} onOpen={onViewChecklist} /></div>
            )}
            <Stops aria-label={`Entregas da ${label(r).toLowerCase()} de ${driver.name}`}>
              {items.map((d) => <StopRow key={d.id} d={d} busy={busy} onUnload={onUnload} onViewProof={onViewProof} />)}
            </Stops>
          </RunGroup>
        );
      })}
      {current.length === 0 ? (
        <Muted>Nenhuma entrega no caminhão.</Muted>
      ) : (
        <Stops aria-label={`Paradas de ${driver.name}`}>
          {current.map((d, i) => (
            <StopRow key={d.id} d={d} number={i + 1} busy={busy} onUnload={onUnload} onViewProof={onViewProof} />
          ))}
        </Stops>
      )}
      <Button type="button" $variant="secondary" disabled={!selectedCount || busy} onClick={onLoad}>
        {selectedCount ? `Carregar ${plural(selectedCount, 'entrega', 'entregas')} aqui` : 'Marque entregas para carregar'}
      </Button>
    </Truck>
  );
}

const emptyDelivery = {
  customer_name: '',
  customer_phone: '',
  invoice_number: '',
  address: '',
  city: { name: '', uf: null } as CityValue,
  weight_kg: '',
  volumes: '',
};

function DeliveryForm({ day, onCancel, onCreated }: { day: string; onCancel: () => void; onCreated: (d: Delivery) => void }) {
  const create = useCreateDelivery();
  const [form, setForm] = useState({ ...emptyDelivery, scheduled_for: day });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        scheduled_for: form.scheduled_for,
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim() || null,
        address: form.address.trim(),
        city: form.city.name.trim(),
        invoice_number: form.invoice_number.trim() || null,
        weight_kg: Number(form.weight_kg),
        volumes: form.volumes ? Number(form.volumes) : null,
      },
      { onSuccess: onCreated },
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <FormGrid style={{ marginBottom: 24 }}>
        <FieldLabel>
          Cliente *
          <Input value={form.customer_name} onChange={(e) => set({ customer_name: e.target.value })} required minLength={2} />
        </FieldLabel>
        <FieldLabel>
          WhatsApp do cliente
          <Input type="tel" inputMode="tel" value={form.customer_phone} onChange={(e) => set({ customer_phone: e.target.value })} placeholder="(31) 98888-7777" />
        </FieldLabel>
        <FieldLabel>
          Nota fiscal
          <Input value={form.invoice_number} onChange={(e) => set({ invoice_number: e.target.value })} placeholder="45.218" />
        </FieldLabel>
        <FieldLabel>
          Cidade *
          <CityInput value={form.city} onChange={(city) => set({ city })} placeholder="Comece a digitar" required minLength={2} />
        </FieldLabel>
        <FieldLabel>
          Endereço *
          <StreetInput
            value={form.address}
            onChange={(address) => set({ address })}
            city={form.city}
            onCityChange={(city) => set({ city })}
            placeholder="Rua e número, ou CEP"
            required
            minLength={3}
          />
        </FieldLabel>
        <FieldLabel>
          Peso (kg) *
          <Input type="number" min={0.1} step={0.1} value={form.weight_kg} onChange={(e) => set({ weight_kg: e.target.value })} required />
        </FieldLabel>
        <FieldLabel>
          Volumes
          <Input type="number" min={1} step={1} value={form.volumes} onChange={(e) => set({ volumes: e.target.value })} />
        </FieldLabel>
        <FieldLabel>
          Dia da entrega *
          <Input type="date" value={form.scheduled_for} onChange={(e) => set({ scheduled_for: e.target.value })} required />
        </FieldLabel>
      </FormGrid>
      {create.isError && <ErrorText role="alert" style={{ marginBottom: 16 }}>{errorMessage(create.error)}</ErrorText>}
      <FormActions>
        <Button type="button" $variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Salvando…' : 'Adicionar entrega'}</Button>
      </FormActions>
    </form>
  );
}

export function DispatchPage() {
  const [day, setDay] = useState(todayISO());
  const [selected, setSelected] = useState<number[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<Delivery | null>(null);
  const [checklistId, setChecklistId] = useState<number | null>(null);

  const deliveries = useDeliveries(day);
  const drivers = useDrivers();
  const vehicles = useVehicles();
  const runs = useRuns(day);
  const estimates = useRegionEstimates(day);
  const assign = useAssignDeliveries();
  const remove = useDeleteDelivery();

  const all = deliveries.data ?? [];
  const pending = all.filter((d) => d.status === 'pending');
  const pendingById = new Map(pending.map((d) => [d.id, d]));
  // A ordem de marcação vira a ordem das paradas
  const selection = selected.filter((id) => pendingById.has(id));
  const selectedKg = sumKg(selection.map((id) => pendingById.get(id)!));
  const activeDrivers = (drivers.data ?? []).filter((d) => d.active);
  const busy = assign.isPending || remove.isPending;
  const actionError = assign.error ?? remove.error;

  const changeDay = (value: string) => {
    setDay(value);
    setSelected([]);
  };
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allChecked = pending.length > 0 && selection.length === pending.length;

  const loadInto = (driverId: number) =>
    assign.mutate({ delivery_ids: selection, driver_id: driverId }, { onSuccess: () => setSelected([]) });
  const unload = (d: Delivery) => assign.mutate({ delivery_ids: [d.id], driver_id: null });
  const destroy = (d: Delivery) => {
    if (window.confirm(`Excluir a entrega de ${d.customer_name}?`)) remove.mutate(d.id);
  };

  return (
    <>
      <PageHeader>
        <div style={{ flexGrow: 1 }}>
          <h1>Carregamento</h1>
          <Muted>Marque as entregas e coloque no caminhão de um motorista. A ordem em que você marca vira a ordem das paradas.</Muted>
        </div>
        <FieldLabel>
          Dia
          <Input type="date" value={day} onChange={(e) => e.target.value && changeDay(e.target.value)} />
        </FieldLabel>
        <Button type="button" onClick={() => setFormOpen(true)}>
          <Icon name="plus" size={20} />
          Nova entrega
        </Button>
      </PageHeader>

      {!!all.length && (
        <Totals>
          <strong>{plural(all.length, 'entrega', 'entregas')}</strong> no dia · {pending.length} aguardando ·{' '}
          {all.length - pending.length} nos caminhões · {fmtKg(sumKg(all))} no total
        </Totals>
      )}
      {actionError && <ErrorText role="alert" style={{ marginBottom: 16 }}>{errorMessage(actionError)}</ErrorText>}

      <Columns>
        <Queue aria-label="Entregas aguardando carregamento">
          <QueueHeader>
            <CardTitle>Aguardando carregamento</CardTitle>
            <Pill $tone="neutral">{pending.length}</Pill>
          </QueueHeader>
          {deliveries.isLoading && <Muted>Carregando entregas…</Muted>}
          {deliveries.isSuccess && pending.length === 0 && (
            <Muted>
              {all.length ? 'Todas as entregas do dia já estão nos caminhões.' : 'Nenhuma entrega neste dia. Use “Nova entrega” para adicionar.'}
            </Muted>
          )}
          {pending.length > 0 && (
            <>
              <SelectAll>
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? [] : [...selection, ...pending.map((d) => d.id).filter((id) => !selection.includes(id))])}
                />
                Marcar todas
              </SelectAll>
              {pending.map((d) => {
                const position = selection.indexOf(d.id);
                return (
                  <QueueRow key={d.id} $checked={position >= 0}>
                    <label>
                      <input type="checkbox" checked={position >= 0} onChange={() => toggle(d.id)} />
                      <Info>
                        <strong>{d.customer_name}</strong>
                        <small>
                          {d.city}
                          {d.invoice_number && ` · NF ${d.invoice_number}`}
                          {d.volumes && ` · ${plural(d.volumes, 'volume', 'volumes')}`}
                        </small>
                        {d.proof?.outcome === 'failed' && (
                          <PreviousAttempt>Tentativa anterior: {REASON_LABEL[d.proof.reason ?? 'other'].toLowerCase()}</PreviousAttempt>
                        )}
                      </Info>
                      {position >= 0 && <OrderBadge aria-hidden="true">{position + 1}º</OrderBadge>}
                      <Weight>{fmtKg(d.weight_kg)}</Weight>
                    </label>
                    <IconButton type="button" aria-label={`Excluir a entrega de ${d.customer_name}`} disabled={busy} onClick={() => destroy(d)}>
                      <Icon name="trash" size={20} />
                    </IconButton>
                  </QueueRow>
                );
              })}
              <QueueFooter aria-live="polite">
                <strong>{plural(selection.length, 'marcada', 'marcadas')}</strong>
                {selection.length > 0 && ` · ${fmtKg(selectedKg)}`}
              </QueueFooter>
            </>
          )}
        </Queue>

        <Trucks>
          {drivers.isSuccess && activeDrivers.length === 0 && (
            <Card>
              <Muted>Nenhum motorista ativo. <Link to="/motoristas">Cadastre um motorista</Link> para distribuir as entregas.</Muted>
            </Card>
          )}
          {activeDrivers.map((driver) => (
            <TruckCard
              key={driver.id}
              driver={driver}
              vehicle={vehicles.data?.find((v) => v.current_driver_id === driver.id)}
              runs={(runs.data ?? []).filter((r) => r.driver_id === driver.id).sort((a, b) => a.started_at.localeCompare(b.started_at))}
              estimate={estimates.data?.find((e) => e.driver_id === driver.id)}
              stops={all
                .filter((d) => d.driver_id === driver.id)
                .sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0))}
              selectedCount={selection.length}
              selectedKg={selectedKg}
              busy={busy}
              onLoad={() => loadInto(driver.id)}
              onUnload={unload}
              onViewProof={setViewing}
              onViewChecklist={setChecklistId}
            />
          ))}
        </Trucks>
      </Columns>

      <ChecklistView checklistId={checklistId} onClose={() => setChecklistId(null)} />
      <ProofView
        delivery={viewing}
        driverName={(drivers.data ?? []).find((d) => d.id === viewing?.proof?.driver_id)?.name}
        onClose={() => setViewing(null)}
      />

      <Dialog open={formOpen} title="Nova entrega" onClose={() => setFormOpen(false)}>
        <DeliveryForm
          day={day}
          onCancel={() => setFormOpen(false)}
          onCreated={(d) => {
            setFormOpen(false);
            changeDay(d.scheduled_for);
          }}
        />
      </Dialog>
    </>
  );
}
