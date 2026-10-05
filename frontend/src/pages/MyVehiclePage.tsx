import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useCreateVehicle, useTires, useUpdateVehicle, useVehicles } from '../api/queries';
import type { Vehicle, VehicleUpdate } from '../api/types';
import {
  Button,
  Card,
  ErrorText,
  FormActions,
  FormGrid,
  Muted,
  PageHeader,
  SuccessText,
} from '../components/ui';
import { TireScreen } from '../components/Tires';
import {
  blankVehicleFields,
  emptyVehicleForm,
  formToVehicle,
  vehicleFieldLabel,
  VehicleFields,
  vehicleToForm,
  type VehicleField,
} from '../components/VehicleFields';

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const TiresHeader = styled.header`
  margin: ${({ theme }) => theme.space(3)} 0 ${({ theme }) => theme.space(2)};
  scroll-margin-top: ${({ theme }) => theme.space(2)};

  h2 { font-size: ${({ theme }) => theme.font.size.xl}; margin-bottom: 4px; }
`;

const Notice = styled.p`
  margin: 0 0 ${({ theme }) => theme.space(3)};
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.cautionTint};
  color: ${({ theme }) => theme.color.cautionInk};
  font-size: ${({ theme }) => theme.font.size.md};
`;

const listText = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}` : items.join('');

/** O motorista ainda sem veículo cadastra o dele, que já fica no seu nome. */
function NewVehicleForm({ onSaved }: { onSaved: () => void }) {
  const create = useCreateVehicle();
  const [form, setForm] = useState(emptyVehicleForm);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate(formToVehicle(form), { onSuccess: onSaved });
  }

  return (
    <form onSubmit={onSubmit}>
      <Notice>
        A base ainda não cadastrou o seu veículo. Preencha os dados abaixo para ele aparecer no carregamento e no rastreamento.
      </Notice>
      <FormGrid style={{ marginBottom: 24 }}>
        <VehicleFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
      </FormGrid>
      {create.isError && <ErrorText role="alert" style={{ marginBottom: 16 }}>{errorMessage(create.error)}</ErrorText>}
      <FormActions>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Salvando…' : 'Cadastrar veículo'}</Button>
      </FormActions>
    </form>
  );
}

/** Veículo já cadastrado: o motorista preenche só o que a base deixou em branco. */
function CompleteVehicleForm({ vehicle, onSaved }: { vehicle: Vehicle; onSaved: () => void }) {
  const update = useUpdateVehicle();
  const [form, setForm] = useState(() => vehicleToForm(vehicle));
  const blank = blankVehicleFields(vehicle);
  const locked = (Object.keys(vehicleFieldLabel) as VehicleField[]).filter((f) => !blank.includes(f));

  const values = formToVehicle(form);
  const filled = blank.filter((f) => values[f] !== null && values[f] !== '');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const patch = Object.fromEntries(filled.map((f) => [f, values[f]])) as VehicleUpdate;
    update.mutate({ id: vehicle.id, ...patch }, { onSuccess: onSaved });
  }

  return (
    <form onSubmit={onSubmit}>
      {blank.length > 0 ? (
        <Notice>
          A base não informou {listText(blank.map((f) => vehicleFieldLabel[f]))} do seu veículo. Preencha abaixo.
        </Notice>
      ) : (
        <Muted style={{ marginBottom: 24 }}>
          Os dados do seu veículo estão completos. Para corrigir algum dado, <Link to="/chat">fale com a base</Link>.
        </Muted>
      )}
      <FormGrid style={{ marginBottom: 24 }}>
        <VehicleFields value={form} locked={locked} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
      </FormGrid>
      {blank.length > 0 && (
        <Stack>
          <Muted>Os dados que a base já cadastrou não podem ser alterados por aqui.</Muted>
          {update.isError && <ErrorText role="alert">{errorMessage(update.error)}</ErrorText>}
          <FormActions>
            <Button type="submit" disabled={!filled.length || update.isPending}>
              {update.isPending ? 'Salvando…' : 'Salvar dados'}
            </Button>
          </FormActions>
        </Stack>
      )}
    </form>
  );
}

/** Desgaste dos pneus logo abaixo dos dados do veículo (quem cadastra e mede é a base). */
function VehicleTires({ vehicle }: { vehicle: Vehicle }) {
  const tires = useTires();
  const { hash } = useLocation();
  const header = useRef<HTMLElement>(null);

  // O atalho "ver pneus" da rota chega com #pneus
  useEffect(() => {
    if (hash === '#pneus' && tires.isSuccess) header.current?.scrollIntoView({ behavior: 'smooth' });
  }, [hash, tires.isSuccess]);

  return (
    <section aria-labelledby="pneus">
      <TiresHeader ref={header}>
        <h2 id="pneus">Pneus</h2>
        <Muted>
          O desgaste sobe conforme você roda nas rotas. Viu algo errado num pneu? <Link to="/chat">Avise a base</Link>.
        </Muted>
      </TiresHeader>
      {tires.isLoading && <Muted>Carregando pneus…</Muted>}
      {tires.isError && <ErrorText role="alert">{errorMessage(tires.error)}</ErrorText>}
      {tires.isSuccess && <TireScreen vehicle={vehicle} tires={tires.data} readOnly />}
    </section>
  );
}

export function MyVehiclePage() {
  const vehicles = useVehicles();
  const [saved, setSaved] = useState(false);
  const vehicle = vehicles.data?.[0];

  return (
    <>
      <PageHeader>
        <div style={{ flexGrow: 1 }}>
          <h1>Meu veículo</h1>
          <Muted>
            Os dados do caminhão que você dirige e o desgaste dos pneus. A capacidade de carga é usada para conferir o peso
            no carregamento.
          </Muted>
        </div>
      </PageHeader>

      <Stack>
        {saved && <SuccessText role="status">Dados do veículo salvos. A base já consegue ver.</SuccessText>}
        <Card>
          {vehicles.isLoading && <Muted>Carregando veículo…</Muted>}
          {vehicles.isError && <ErrorText role="alert">{errorMessage(vehicles.error)}</ErrorText>}
          {vehicles.isSuccess && (vehicle ? (
            <CompleteVehicleForm key={vehicle.id} vehicle={vehicle} onSaved={() => setSaved(true)} />
          ) : (
            <NewVehicleForm onSaved={() => setSaved(true)} />
          ))}
        </Card>
      </Stack>

      {vehicle && <VehicleTires vehicle={vehicle} />}
    </>
  );
}
