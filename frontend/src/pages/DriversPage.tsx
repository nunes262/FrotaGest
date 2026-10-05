import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useCreateDriver, useDrivers, useVehicles } from '../api/queries';
import type { CnhCategory, Driver, DriverCreate, DriverPurge, DriverRemoval, Vehicle } from '../api/types';
import { Dialog } from '../components/Dialog';
import { PurgeDriverDialog, ReactivateDriverDialog, RemoveDriverDialog } from '../components/DriverRemoval';
import { Icon } from '../components/Icon';
import { emptyVehicleForm, formToVehicle, VehicleFields, type VehicleFormState } from '../components/VehicleFields';
import {
  Button,
  Card,
  CardTitle,
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
import { fmtCpf, fmtDate, fmtPhone, onlyDigits, todayISO } from '../format';

const CNH_CATEGORIES: CnhCategory[] = ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'];

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const NameCell = styled.td`
  strong { display: block; color: ${({ theme }) => theme.color.textStrong}; }
  small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const Hint = styled(Muted)`
  margin-top: ${({ theme }) => theme.space(1)};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

function CnhExpiry({ date }: { date: string | null }) {
  if (!date) return <>–</>;
  if (date < todayISO()) return <Pill $tone="danger">Vencida em {fmtDate(date)}</Pill>;
  if (date <= todayISO(30)) return <Pill $tone="caution">Vence em {fmtDate(date)}</Pill>;
  return <>{fmtDate(date)}</>;
}

interface FormState {
  name: string;
  cpf: string;
  phone: string;
  cnh_number: string;
  cnh_category: CnhCategory | '';
  cnh_expires_at: string;
  password: string;
  /** '' = sem veículo, 'new' = cadastrar um novo, ou o id de um veículo já cadastrado */
  vehicle: string;
  newVehicle: VehicleFormState;
}

const emptyForm: FormState = {
  name: '',
  cpf: '',
  phone: '',
  cnh_number: '',
  cnh_category: '',
  cnh_expires_at: '',
  password: '',
  vehicle: '',
  newVehicle: emptyVehicleForm,
};

interface FormProps {
  vehicles: Vehicle[];
  drivers: Driver[];
  onCancel: () => void;
  onCreated: (driver: Driver) => void;
}

function DriverForm({ vehicles, drivers, onCancel, onCreated }: FormProps) {
  const create = useCreateDriver();
  const [form, setForm] = useState(emptyForm);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const driverName = (id: number | null) => drivers.find((d) => d.id === id)?.name;
  const chosen = vehicles.find((v) => String(v.id) === form.vehicle);
  const chosenOwner = chosen && driverName(chosen.current_driver_id);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body: DriverCreate = {
      name: form.name.trim(),
      cpf: onlyDigits(form.cpf),
      phone: form.phone || null,
      cnh_number: form.cnh_number || null,
      cnh_category: form.cnh_category || null,
      cnh_expires_at: form.cnh_expires_at || null,
      password: form.password,
    };
    if (chosen) body.vehicle_id = chosen.id;
    if (form.vehicle === 'new') body.new_vehicle = formToVehicle(form.newVehicle);
    create.mutate(body, { onSuccess: onCreated });
  }

  return (
    <form onSubmit={onSubmit}>
      <FormSection>
        <legend>Dados do motorista</legend>
        <FormGrid>
          <FieldLabel>
            Nome completo *
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} required minLength={3} autoComplete="off" />
          </FieldLabel>
          <FieldLabel>
            CPF *
            <Input
              value={form.cpf}
              onChange={(e) => set({ cpf: fmtCpf(e.target.value) })}
              inputMode="numeric"
              placeholder="000.000.000-00"
              pattern="\d{3}\.\d{3}\.\d{3}-\d{2}"
              title="Digite os 11 números do CPF."
              autoComplete="off"
              required
            />
          </FieldLabel>
          <FieldLabel>
            Celular
            <Input
              value={form.phone}
              onChange={(e) => set({ phone: fmtPhone(e.target.value) })}
              inputMode="tel"
              placeholder="(31) 98888-7777"
              pattern="\(\d{2}\) \d{4,5}-\d{4}"
              title="Digite o DDD e o número."
              autoComplete="off"
            />
          </FieldLabel>
        </FormGrid>
      </FormSection>

      <FormSection>
        <legend>CNH</legend>
        <FormGrid>
          <FieldLabel>
            Número da CNH
            <Input
              value={form.cnh_number}
              onChange={(e) => set({ cnh_number: onlyDigits(e.target.value).slice(0, 11) })}
              inputMode="numeric"
              pattern="\d{11}"
              title="A CNH tem 11 números."
              autoComplete="off"
            />
          </FieldLabel>
          <FieldLabel>
            Categoria
            <Select value={form.cnh_category} onChange={(e) => set({ cnh_category: e.target.value as CnhCategory | '' })}>
              <option value="">Selecione</option>
              {CNH_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </FieldLabel>
          <FieldLabel>
            Validade
            <Input type="date" value={form.cnh_expires_at} onChange={(e) => set({ cnh_expires_at: e.target.value })} />
          </FieldLabel>
        </FormGrid>
      </FormSection>

      <FormSection>
        <legend>Veículo</legend>
        <FormGrid>
          <FieldLabel>
            Veículo do motorista
            <Select value={form.vehicle} onChange={(e) => set({ vehicle: e.target.value })}>
              <option value="">Sem veículo por enquanto</option>
              {vehicles.map((v) => {
                const owner = driverName(v.current_driver_id);
                return (
                  <option key={v.id} value={v.id}>
                    {v.plate}{v.model ? ` · ${v.model}` : ''}{owner ? ` (hoje com ${owner})` : ' (livre)'}
                  </option>
                );
              })}
              <option value="new">+ Cadastrar veículo novo</option>
            </Select>
          </FieldLabel>
        </FormGrid>
        {chosenOwner && <Hint>O veículo {chosen.plate} sai de {chosenOwner} e passa para este motorista.</Hint>}
        {form.vehicle === 'new' && (
          <FormGrid style={{ marginTop: 16 }}>
            <VehicleFields
              value={form.newVehicle}
              onChange={(patch) => set({ newVehicle: { ...form.newVehicle, ...patch } })}
            />
          </FormGrid>
        )}
      </FormSection>

      <FormSection>
        <legend>Acesso ao app</legend>
        <FormGrid>
          <FieldLabel>
            Senha inicial *
            <Input
              type="password"
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              minLength={6}
              autoComplete="new-password"
              required
            />
          </FieldLabel>
        </FormGrid>
        <Hint>O motorista entra no app com o CPF e essa senha. Mínimo de 6 caracteres.</Hint>
      </FormSection>

      <Stack>
        {create.isError && <ErrorText role="alert">{errorMessage(create.error)}</ErrorText>}
        <FormActions>
          <Button type="button" $variant="secondary" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Salvando…' : 'Cadastrar motorista'}
          </Button>
        </FormActions>
      </Stack>
    </form>
  );
}

function removalText({ driver, released_vehicles, returned_deliveries, finished_run }: DriverRemoval) {
  const parts = [`${driver.name} foi removido e não acessa mais o app.`];
  if (released_vehicles.length) parts.push(`O veículo ${released_vehicles.join(', ')} ficou livre.`);
  if (returned_deliveries) {
    parts.push(`${returned_deliveries} ${returned_deliveries === 1 ? 'entrega voltou' : 'entregas voltaram'} para a fila de carregamento.`);
  }
  if (finished_run) parts.push('A rota em andamento foi encerrada.');
  return parts.join(' ');
}

function purgeText(p: DriverPurge) {
  const parts = [
    `${p.name} foi excluído de vez: ${p.runs} ${p.runs === 1 ? 'rota' : 'rotas'}, ${p.gps_points.toLocaleString('pt-BR')} pontos de GPS,`,
    `${p.messages} ${p.messages === 1 ? 'mensagem' : 'mensagens'} e ${p.proofs} ${p.proofs === 1 ? 'comprovante' : 'comprovantes'} apagados.`,
  ];
  if (p.payments) parts.push(`${p.payments} ${p.payments === 1 ? 'lançamento de pagamento apagado' : 'lançamentos de pagamento apagados'}.`);
  if (p.deliveries_kept) {
    parts.push(`${p.deliveries_kept} ${p.deliveries_kept === 1 ? 'entrega feita continua' : 'entregas feitas continuam'} no histórico, sem o nome dele.`);
  }
  return parts.join(' ');
}

const RemovedList = styled.ul`
  list-style: none;
  margin: ${({ theme }) => theme.space(2)} 0 0;
  padding: 0;

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 0;
    border-bottom: 1px solid ${({ theme }) => theme.color.border};
  }
  li:last-child { border-bottom: 0; padding-bottom: 0; }
  li > div { display: flex; flex-wrap: wrap; gap: 8px; }
  strong { color: ${({ theme }) => theme.color.textStrong}; }
  small { margin-left: 8px; font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  ${Button} { height: 36px; padding: 0 12px; }
`;

const RowButton = styled(Button)`
  height: 36px;
  padding: 0 12px;
`;

export function DriversPage() {
  const drivers = useDrivers();
  const vehicles = useVehicles();
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Driver | null>(null);
  const [reactivating, setReactivating] = useState<Driver | null>(null);
  const [purging, setPurging] = useState<Driver | null>(null);
  const active = (drivers.data ?? []).filter((d) => d.active);
  const removed = (drivers.data ?? []).filter((d) => !d.active);

  const vehicleOf = (driverId: number) => vehicles.data?.find((v) => v.current_driver_id === driverId);

  return (
    <>
      <PageHeader>
        <div style={{ flexGrow: 1 }}>
          <h1>Motoristas</h1>
          <Muted>Cadastre os motoristas, a CNH e o veículo de cada um.</Muted>
        </div>
        <Button type="button" onClick={() => { setNotice(null); setFormOpen(true); }}>
          <Icon name="plus" size={20} />
          Novo motorista
        </Button>
      </PageHeader>

      <Stack>
        {notice && <SuccessText role="status">{notice}</SuccessText>}
        <Card>
          {drivers.isLoading && <Muted>Carregando motoristas…</Muted>}
          {drivers.isSuccess && active.length === 0 && (
            <Muted>Nenhum motorista ativo. Use “Novo motorista” para cadastrar.</Muted>
          )}
          {active.length > 0 && (
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th>Motorista</th>
                    <th>CPF</th>
                    <th>CNH</th>
                    <th>Validade da CNH</th>
                    <th>Veículo</th>
                    <th><SrOnly>Ações</SrOnly></th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((d) => {
                    const vehicle = vehicleOf(d.id);
                    return (
                      <tr key={d.id}>
                        <NameCell>
                          <strong>{d.name}</strong>
                          {d.phone && <small>{d.phone}</small>}
                        </NameCell>
                        <td>{d.cpf ? fmtCpf(d.cpf) : '–'}</td>
                        <td>{d.cnh_number ? `${d.cnh_number}${d.cnh_category ? ` · cat. ${d.cnh_category}` : ''}` : '–'}</td>
                        <td><CnhExpiry date={d.cnh_expires_at} /></td>
                        <td>
                          {vehicle ? (
                            <Link to={`/veiculos?editar=${vehicle.id}`} title="Editar veículo">
                              {vehicle.plate}{vehicle.model ? ` · ${vehicle.model}` : ''}
                            </Link>
                          ) : (
                            <Link to="/veiculos"><Pill $tone="neutral">Sem veículo</Pill></Link>
                          )}
                        </td>
                        <td>
                          <RowButton type="button" $variant="secondary" onClick={() => { setNotice(null); setRemoving(d); }} aria-label={`Remover ${d.name}`}>
                            <Icon name="trash" size={18} />
                            Remover
                          </RowButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Card>

        {removed.length > 0 && (
          <Card aria-labelledby="removed-title">
            <CardTitle id="removed-title">Motoristas removidos ({removed.length})</CardTitle>
            <Muted style={{ marginTop: 4, fontSize: 12 }}>
              Sem acesso ao app. O histórico deles continua nas rotas, comprovantes e conversas, até você excluir de vez.
            </Muted>
            <RemovedList>
              {removed.map((d) => (
                <li key={d.id}>
                  <span><strong>{d.name}</strong>{d.cpf && <small>{fmtCpf(d.cpf)}</small>}</span>
                  <div>
                    <Button type="button" $variant="secondary" onClick={() => { setNotice(null); setReactivating(d); }} aria-label={`Reativar ${d.name}`}>
                      Reativar
                    </Button>
                    <Button type="button" $variant="secondary" onClick={() => { setNotice(null); setPurging(d); }} aria-label={`Excluir ${d.name} de vez`}>
                      <Icon name="trash" size={16} />
                      Excluir de vez
                    </Button>
                  </div>
                </li>
              ))}
            </RemovedList>
          </Card>
        )}
      </Stack>

      <RemoveDriverDialog
        driver={removing}
        vehicle={removing ? vehicleOf(removing.id) : undefined}
        onClose={() => setRemoving(null)}
        onRemoved={(result) => {
          setRemoving(null);
          setNotice(removalText(result));
        }}
      />
      <PurgeDriverDialog
        driver={purging}
        onClose={() => setPurging(null)}
        onPurged={(result) => {
          setPurging(null);
          setNotice(purgeText(result));
        }}
      />
      <ReactivateDriverDialog
        driver={reactivating}
        freeVehicles={(vehicles.data ?? []).filter((v) => !v.current_driver_id)}
        onClose={() => setReactivating(null)}
        onReactivated={(driver) => {
          setReactivating(null);
          setNotice(`${driver.name} foi reativado e já pode entrar no app.`);
        }}
      />

      <Dialog open={formOpen} title="Novo motorista" onClose={() => setFormOpen(false)}>
        <DriverForm
          vehicles={vehicles.data ?? []}
          drivers={drivers.data ?? []}
          onCancel={() => setFormOpen(false)}
          onCreated={(driver) => {
            setNotice(`Cadastro de ${driver.name} concluído. Já dá para entrar no app com o CPF e a senha.`);
            setFormOpen(false);
          }}
        />
      </Dialog>
    </>
  );
}
