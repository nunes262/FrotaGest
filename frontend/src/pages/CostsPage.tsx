import { useState, type FormEvent } from 'react';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useCostSummary, useRefreshFuelPrices, useSetFuelPrice, useUpdateVehicle, type CostFilters } from '../api/queries';
import type { FuelPrice, FuelType, VehicleCost } from '../api/types';
import { FuelEntries } from '../components/FuelEntries';
import { FUEL_LABEL } from '../components/VehicleFields';
import {
  Button,
  Card,
  CardTitle,
  ErrorText,
  Input,
  Muted,
  PageHeader,
  Pill,
  Select,
  Table,
  TableScroll,
} from '../components/ui';
import { fmtBRL, fmtDate, fmtKm } from '../format';
import { PERIODS, periodRange, type Period } from '../period';

const MISSING_LABEL: Record<VehicleCost['missing'][number], string> = {
  fuel_type: 'combustível',
  km_per_liter: 'consumo',
  price: 'preço do litro',
};

const Segmented = styled.div`
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

const Filters = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.space(2)};
  align-items: center;
  margin-bottom: ${({ theme }) => theme.space(2)};
`;

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: ${({ theme }) => theme.space(2)};
`;

const Big = styled.strong`
  display: block;
  margin: 4px 0 ${({ theme }) => theme.space(2)};
  font-size: ${({ theme }) => theme.font.size.h1};
  color: ${({ theme }) => theme.color.textStrong};
`;

const ShareRow = styled.div`
  margin-top: ${({ theme }) => theme.space(1)};
  > div:first-child { display: flex; justify-content: space-between; font-size: ${({ theme }) => theme.font.size.md}; margin-bottom: 4px; }
`;

const ShareBar = styled.div<{ $pct: number; $color: string }>`
  height: 8px;
  border-radius: 4px;
  background: ${({ theme }) => theme.color.neutralTint};
  overflow: hidden;
  &::after { content: ''; display: block; height: 100%; width: ${({ $pct }) => $pct}%; background: ${({ $color }) => $color}; }
`;

const PriceTile = styled.div`
  flex: 1 1 220px;
  padding: ${({ theme }) => theme.space(2)};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius};

  > span { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  > strong { display: block; font-size: ${({ theme }) => theme.font.size.h2}; color: ${({ theme }) => theme.color.textStrong}; }
  small { display: block; font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  form { display: flex; gap: 6px; margin-top: 8px; }
  form ${Input} { width: 110px; min-width: 0; }
  form ${Button} { height: 44px; padding: 0 12px; }
`;

const Tiles = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.space(2)};
  margin-top: ${({ theme }) => theme.space(2)};
`;

const Mini = styled(Card)`
  > span { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  > strong { display: block; margin-top: 4px; font-size: ${({ theme }) => theme.font.size.h2}; color: ${({ theme }) => theme.color.textStrong}; }
  > small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const Above = styled.span`
  color: ${({ theme }) => theme.color.dangerInk};
  font-weight: ${({ theme }) => theme.font.weight.bold};
`;

const InlineEdit = styled.form`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  ${Select}, ${Input} { height: 36px; min-width: 0; }
  ${Select} { width: 120px; }
  ${Input} { width: 80px; }
  ${Button} { height: 36px; padding: 0 12px; }
`;

const LinkButton = styled.button`
  all: unset;
  cursor: pointer;
  color: ${({ theme }) => theme.color.primary};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  text-decoration: underline;
  font-size: ${({ theme }) => theme.font.size.sm};
`;

const Warning = styled.p`
  margin: 0;
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.cautionTint};
  color: ${({ theme }) => theme.color.cautionInk};
  font-size: ${({ theme }) => theme.font.size.md};
`;

const fmtLiter = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} l`;

function PriceCard({ price }: { price: FuelPrice }) {
  const setPrice = useSetFuelPrice();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPrice.mutate({ fuel: price.fuel_type, price: Number(value) }, { onSuccess: () => setEditing(false) });
  }

  return (
    <PriceTile>
      <span>{FUEL_LABEL[price.fuel_type]}</span>
      <strong>{price.price_per_liter ? `${fmtBRL(price.price_per_liter)}/l` : '–'}</strong>
      {price.source && (
        <Pill $tone={price.source === 'anp' ? 'success' : 'neutral'} style={{ margin: '4px 0' }}>
          {price.source === 'anp' ? 'ANP' : 'Informado'}
        </Pill>
      )}
      <small>{price.reference ?? 'Sem preço ainda'}</small>
      {editing ? (
        <form onSubmit={onSubmit} aria-label={`Preço do ${FUEL_LABEL[price.fuel_type]}`}>
          <Input type="number" min={0.5} max={50} step={0.01} value={value} onChange={(e) => setValue(e.target.value)} required autoFocus aria-label="R$ por litro" />
          <Button type="submit" disabled={setPrice.isPending}>Salvar</Button>
          <Button type="button" $variant="secondary" onClick={() => setEditing(false)}>Cancelar</Button>
        </form>
      ) : (
        <LinkButton type="button" style={{ marginTop: 8 }} onClick={() => { setValue(price.price_per_liter ? String(price.price_per_liter) : ''); setEditing(true); }}>
          Informar o preço que a empresa paga
        </LinkButton>
      )}
      {setPrice.isError && <ErrorText role="alert" style={{ marginTop: 8 }}>{errorMessage(setPrice.error)}</ErrorText>}
    </PriceTile>
  );
}

function FuelCell({ row }: { row: VehicleCost }) {
  const update = useUpdateVehicle();
  const [editing, setEditing] = useState(false);
  const [fuel, setFuel] = useState<FuelType | ''>(row.fuel_type ?? '');
  const [kpl, setKpl] = useState(row.km_per_liter ? String(row.km_per_liter) : '');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    update.mutate(
      { id: row.vehicle_id, fuel_type: fuel || null, km_per_liter: kpl ? Number(kpl) : null },
      { onSuccess: () => setEditing(false) },
    );
  }

  if (editing) {
    return (
      <InlineEdit onSubmit={onSubmit} aria-label={`Combustível e consumo de ${row.plate}`}>
        <Select value={fuel} onChange={(e) => setFuel(e.target.value as FuelType | '')} aria-label="Combustível">
          <option value="">Combustível</option>
          {(Object.keys(FUEL_LABEL) as FuelType[]).map((f) => <option key={f} value={f}>{FUEL_LABEL[f]}</option>)}
        </Select>
        <Input type="number" min={0.5} max={50} step={0.1} value={kpl} onChange={(e) => setKpl(e.target.value)} placeholder="km/l" aria-label="Consumo em km/l" />
        <Button type="submit" disabled={update.isPending}>Salvar</Button>
        {update.isError && <ErrorText role="alert">{errorMessage(update.error)}</ErrorText>}
      </InlineEdit>
    );
  }
  return (
    <>
      {row.fuel_type ? FUEL_LABEL[row.fuel_type] : '–'}
      {row.km_per_liter ? ` · ${row.km_per_liter.toLocaleString('pt-BR')} km/l` : ''}{' '}
      <LinkButton type="button" onClick={() => setEditing(true)} aria-label={`Editar combustível de ${row.plate}`}>editar</LinkButton>
    </>
  );
}

/** Gestor: custo da frota no período, por veículo, com o preço do combustível da ANP. */
export function CostsPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [fuel, setFuel] = useState<FuelType | null>(null);
  const filters: CostFilters = { ...periodRange(period), ...(fuel ? { fuel_type: fuel } : {}) };
  const summary = useCostSummary(filters);
  const refresh = useRefreshFuelPrices();
  const data = summary.data;
  const share = (part: number) => (data?.total_cost ? Math.round((part / data.total_cost) * 100) : 0);
  const prices = (data?.prices ?? []).filter((p) => !fuel || p.fuel_type === fuel);
  const incomplete = (data?.vehicles ?? []).filter((v) => v.missing.length);

  return (
    <>
      <PageHeader>
        <div style={{ flexGrow: 1 }}>
          <h1>Custos da frota</h1>
          <Muted>Combustível e pneus sobre os km rodados nas rotas, com o preço do litro da ANP.</Muted>
        </div>
      </PageHeader>

      <Filters>
        <Segmented role="group" aria-label="Período">
          {PERIODS.map((p) => (
            <Chip key={p.value} type="button" $active={period === p.value} aria-pressed={period === p.value} onClick={() => setPeriod(p.value)}>
              {p.label}
            </Chip>
          ))}
        </Segmented>
        <Segmented role="group" aria-label="Combustível">
          <Chip type="button" $active={!fuel} aria-pressed={!fuel} onClick={() => setFuel(null)}>Todos</Chip>
          {(Object.keys(FUEL_LABEL) as FuelType[]).map((f) => (
            <Chip key={f} type="button" $active={fuel === f} aria-pressed={fuel === f} onClick={() => setFuel(f)}>{FUEL_LABEL[f]}</Chip>
          ))}
        </Segmented>
        {data && <Muted style={{ fontSize: 12 }}>{fmtDate(data.date_from)} a {fmtDate(data.date_to)}</Muted>}
      </Filters>

      {summary.isLoading && <Muted>Calculando…</Muted>}
      {summary.isError && <ErrorText role="alert">{errorMessage(summary.error)}</ErrorText>}
      {data && (
        <Stack>
          <Grid>
            <Card>
              <CardTitle>Total do período</CardTitle>
              <Big>{fmtBRL(data.total_cost)}</Big>
              <ShareRow>
                <div><span>Combustível</span><span>{fmtBRL(data.fuel_cost)} · {share(data.fuel_cost)}%</span></div>
                <ShareBar $pct={share(data.fuel_cost)} $color="#cc0000" />
              </ShareRow>
              <ShareRow>
                <div><span>Pneus</span><span>{fmtBRL(data.tire_cost)} · {share(data.tire_cost)}%</span></div>
                <ShareBar $pct={share(data.tire_cost)} $color="#3d3d3d" />
              </ShareRow>
            </Card>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <CardTitle>Preço do litro</CardTitle>
                <Button type="button" $variant="secondary" style={{ height: 36 }} disabled={refresh.isPending} onClick={() => refresh.mutate()}>
                  {refresh.isPending ? 'Buscando…' : 'Atualizar pela ANP'}
                </Button>
              </div>
              <Tiles>{prices.map((p) => <PriceCard key={p.fuel_type} price={p} />)}</Tiles>
              {refresh.isError && <ErrorText role="alert" style={{ marginTop: 12 }}>{errorMessage(refresh.error)}</ErrorText>}
            </Card>
          </Grid>

          <Grid>
            <Mini><span>Km rodados nas rotas</span><strong>{fmtKm(data.distance_km)}</strong></Mini>
            <Mini>
              <span>Custo por km</span>
              <strong>{data.cost_per_km !== null ? fmtBRL(data.cost_per_km) : '–'}</strong>
              <small>combustível + pneus</small>
            </Mini>
            <Mini>
              <span>Litros estimados</span>
              <strong>{fmtLiter(data.vehicles.reduce((t, v) => t + (v.liters ?? 0), 0))}</strong>
              <small>km ÷ consumo de cada veículo</small>
            </Mini>
            <Mini>
              <span>Gasto real com combustível</span>
              <strong>{fmtBRL(data.refuel_spent)}</strong>
              <small>{data.refuel_liters ? `${fmtLiter(data.refuel_liters)} nos abastecimentos registrados` : 'nenhum abastecimento registrado'}</small>
            </Mini>
          </Grid>

          {incomplete.length > 0 && (
            <Warning role="status">
              Falta informação em {incomplete.map((v) => v.plate).join(', ')}: sem ela o custo de combustível não entra na conta.
              Use “editar” na tabela.
            </Warning>
          )}

          <Card>
            <CardTitle style={{ marginBottom: 8 }}>Por veículo</CardTitle>
            {data.vehicles.length === 0 ? (
              <Muted>Nenhum veículo {fuel ? `a ${FUEL_LABEL[fuel].toLowerCase()}` : ''} na frota.</Muted>
            ) : (
              <TableScroll>
                <Table style={{ minWidth: 980 }}>
                  <thead>
                    <tr>
                      <th>Veículo</th>
                      <th>Motorista</th>
                      <th>Combustível e consumo</th>
                      <th>Km</th>
                      <th>Litros</th>
                      <th>Combustível</th>
                      <th>Abastecido</th>
                      <th>Pneus</th>
                      <th>Total</th>
                      <th>Custo/km</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.vehicles.map((v) => (
                      <tr key={v.vehicle_id}>
                        <td><strong>{v.plate}</strong>{v.model && <><br /><small>{v.model}</small></>}</td>
                        <td>{v.drivers.join(', ') || '–'}</td>
                        <td>
                          <FuelCell row={v} />
                          {v.missing.length > 0 && (
                            <div style={{ marginTop: 4 }}>
                              <Pill $tone="caution">Falta {v.missing.map((m) => MISSING_LABEL[m]).join(' e ')}</Pill>
                            </div>
                          )}
                        </td>
                        <td>{fmtKm(v.distance_km)}</td>
                        <td>{v.liters !== null ? fmtLiter(v.liters) : '–'}</td>
                        <td>{v.fuel_cost !== null ? fmtBRL(v.fuel_cost) : '–'}</td>
                        <td>
                          {v.refuel_count ? (
                            <>
                              {fmtBRL(v.refuel_spent)}<br />
                              <small>
                                {fmtLiter(v.refuel_liters)}{v.real_km_per_liter !== null ? ` · ${v.real_km_per_liter.toLocaleString('pt-BR')} km/l real` : ''}
                              </small>
                              {v.consumption_alert && <div style={{ marginTop: 4 }}><Pill $tone="danger">Consumo fora do normal</Pill></div>}
                            </>
                          ) : '–'}
                        </td>
                        <td>{fmtBRL(v.tire_cost)}</td>
                        <td><strong>{v.total_cost !== null ? fmtBRL(v.total_cost) : '–'}</strong></td>
                        <td>
                          {v.cost_per_km === null
                            ? '–'
                            : data.cost_per_km !== null && v.cost_per_km > data.cost_per_km * 1.1
                              ? <Above title="Acima da média da frota">{fmtBRL(v.cost_per_km)} ▲</Above>
                              : fmtBRL(v.cost_per_km)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
            <Muted style={{ marginTop: 16, fontSize: 12 }}>
              Os km vêm das rotas iniciadas pelos motoristas (rastreador do veículo ou GPS do celular). Pneus: preço pago ÷
              vida útil, pelos pneus que estão rodando. ▲ = mais de 10% acima do custo por km da frota. “Abastecido” é o gasto
              real nos abastecimentos registrados pelos motoristas; o consumo real é km das rotas ÷ litros, e o alerta aparece
              quando ele fica mais de 20% pior que o informado.
            </Muted>
          </Card>
          <FuelEntries dateFrom={filters.date_from} dateTo={filters.date_to} />
        </Stack>
      )}
    </>
  );
}
