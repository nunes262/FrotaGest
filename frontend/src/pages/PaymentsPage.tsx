import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useDrivers, useLaunchRunPayment, usePaymentsOverview, usePayPayments, useUnpayPayment } from '../api/queries';
import type { Payment, PaymentRun } from '../api/types';
import { Dialog } from '../components/Dialog';
import { ExpenseReview } from '../components/ExpenseReview';
import { RegionTableEditor } from '../components/RegionTable';
import {
  Button,
  Card,
  CardTitle,
  ErrorText,
  FieldLabel,
  FormActions,
  Input,
  Muted,
  PageHeader,
  Pill,
  Select,
  Table,
  TableScroll,
} from '../components/ui';
import { fmtBRL, fmtDate, fmtKg, fmtKm, plural, todayISO } from '../format';
import { PERIODS, periodRange, type Period } from '../period';

const Filters = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.space(2)};
  align-items: flex-end;
  margin-bottom: ${({ theme }) => theme.space(2)};
`;

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

const Rows = styled(Table)`
  td small { display: block; font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.actions { white-space: nowrap; text-align: right; }
  td.actions ${Button} { height: 36px; padding: 0 12px; margin-left: 6px; }
`;

const Money = styled.strong<{ $tone?: 'caution' | 'success' }>`
  color: ${({ theme, $tone }) => ($tone === 'caution' ? theme.color.cautionInk : $tone === 'success' ? theme.color.successInk : theme.color.textStrong)};
`;

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

function RunStatusPill({ run, payment }: { run: PaymentRun; payment?: Payment }) {
  if (payment?.status === 'paid') return <Pill $tone="success">Pago em {fmtDate(payment.paid_on!)}</Pill>;
  if (payment) return <Pill $tone="warning">A pagar</Pill>;
  if (run.status === 'active') return <Pill $tone="neutral">Em andamento</Pill>;
  if (run.region_price === null) return <Pill $tone="caution">Fora da tabela</Pill>;
  return <Pill $tone="caution">Não lançada</Pill>;
}

/** Marcar como pago (um lançamento ou tudo o que um motorista tem a receber). */
function PayDialog({ payments, onClose }: { payments: Payment[]; onClose: () => void }) {
  const pay = usePayPayments();
  const [paidOn, setPaidOn] = useState(todayISO());
  const total = payments.reduce((s, p) => s + p.amount, 0);
  return (
    <Dialog open size="small" title="Marcar como pago" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); pay.mutate({ ids: payments.map((p) => p.id), paidOn }, { onSuccess: onClose }); }}>
        <Stack>
          <Muted>
            {plural(payments.length, 'lançamento', 'lançamentos')} de {payments[0]?.driver_name ?? 'motorista'}: <strong>{fmtBRL(total)}</strong>.
            O motorista vê o pagamento na hora.
          </Muted>
          <FieldLabel>
            Data do pagamento
            <Input type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} required />
          </FieldLabel>
          {pay.isError && <ErrorText role="alert">{errorMessage(pay.error)}</ErrorText>}
          <FormActions>
            <Button type="button" $variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={pay.isPending}>{pay.isPending ? 'Salvando…' : `Pago ${fmtBRL(total)}`}</Button>
          </FormActions>
        </Stack>
      </form>
    </Dialog>
  );
}

const paymentTitle = (p: Payment) =>
  p.description ?? (p.runs.length === 1 ? `Rota de ${fmtDate(p.runs[0].day)}` : p.runs.length ? `${p.runs.length} rotas` : 'Rotas apagadas');

/** Gestor: valor de cada rota (ou conjunto de rotas), o que falta pagar a cada motorista e o que já foi pago. */
export function PaymentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') === 'regioes' ? 'regions' : 'payments';
  const [period, setPeriod] = useState<Period>('month');
  const [driverId, setDriverId] = useState<number | null>(null);
  const [paying, setPaying] = useState<Payment[] | null>(null);
  const { date_from, date_to } = periodRange(period);
  const overview = usePaymentsOverview({ dateFrom: date_from, dateTo: date_to, driverId });
  const drivers = useDrivers();
  const unpay = useUnpayPayment();
  const launch = useLaunchRunPayment();

  const data = overview.data;
  const payments = data?.payments ?? [];
  const paymentById = new Map(payments.map((p) => [p.id, p]));
  const runs = data?.runs ?? [];
  const actionError = unpay.error ?? launch.error;

  return (
    <>
      <PageHeader>
        <div style={{ flexGrow: 1 }}>
          <h1>Pagamentos</h1>
          <Muted>
            Cada rota vale o preço fixo da região que atende (aba “Preço por região”) e entra sozinha em “A pagar” quando o motorista
            encerra. Marque o que já pagou; cada motorista vê o que tem a receber.
          </Muted>
        </div>
      </PageHeader>

      <Tabs role="tablist" aria-label="Pagamentos">
        <Tab type="button" role="tab" aria-selected={tab === 'payments'} $active={tab === 'payments'} onClick={() => setParams({})}>Pagamentos</Tab>
        <Tab type="button" role="tab" aria-selected={tab === 'regions'} $active={tab === 'regions'} onClick={() => setParams({ aba: 'regioes' })}>Preço por região</Tab>
      </Tabs>

      {tab === 'regions' ? <RegionTableEditor /> : (
        <>
          <Filters>
            <Chips role="group" aria-label="Período">
              {PERIODS.map((p) => (
                <Chip key={p.value} type="button" $active={period === p.value} aria-pressed={period === p.value} onClick={() => setPeriod(p.value)}>
                  {p.label}
                </Chip>
              ))}
            </Chips>
            <FieldLabel>
              Motorista
              <Select value={driverId ?? ''} onChange={(e) => setDriverId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Todos</option>
                {(drivers.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}{d.active ? '' : ' (removido)'}</option>)}
              </Select>
            </FieldLabel>
          </Filters>

          <Stack>
            {overview.isError && <ErrorText role="alert">{errorMessage(overview.error)}</ErrorText>}
            {actionError && <ErrorText role="alert">{errorMessage(actionError)}</ErrorText>}

            <ExpenseReview dateFrom={date_from} dateTo={date_to} />

            <Card aria-label="Por motorista">
              <CardTitle style={{ marginBottom: 8 }}>Por motorista</CardTitle>
              {overview.isLoading && <Muted>Carregando…</Muted>}
              {data && data.balances.length === 0 && <Muted>Nenhuma rota nem valor lançado nesse período.</Muted>}
              {data && data.balances.length > 0 && (
                <TableScroll>
                  <Rows>
                    <thead>
                      <tr>
                        <th>Motorista</th>
                        <th className="num">A pagar</th>
                        <th className="num">Pago no período</th>
                        <th>Rotas sem valor</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.balances.map((b) => {
                        const pending = payments.filter((p) => p.driver_id === b.driver_id && p.status === 'pending');
                        return (
                          <tr key={b.driver_id}>
                            <td><strong>{b.driver_name ?? 'Motorista excluído'}</strong>{!b.active && <small>removido</small>}</td>
                            <td className="num">
                              <Money $tone={b.pending_amount ? 'caution' : undefined}>{fmtBRL(b.pending_amount)}</Money>
                              <small>{plural(b.pending_count, 'lançamento', 'lançamentos')}</small>
                            </td>
                            <td className="num"><Money $tone={b.paid_amount ? 'success' : undefined}>{fmtBRL(b.paid_amount)}</Money></td>
                            <td>{b.unpriced_runs ? <Pill $tone="caution">{plural(b.unpriced_runs, 'rota', 'rotas')}</Pill> : '–'}</td>
                            <td className="actions">
                              {pending.length > 0 && (
                                <Button type="button" onClick={() => setPaying(pending)}>Pagar {fmtBRL(b.pending_amount)}</Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Rows>
                </TableScroll>
              )}
            </Card>

            <Card aria-label="Rotas do período">
              <CardTitle style={{ marginBottom: 8 }}>Rotas do período</CardTitle>
              {data && runs.length === 0 && <Muted>Nenhuma rota iniciada nesse período.</Muted>}
              {runs.length > 0 && (
                <TableScroll>
                  <Rows>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Motorista</th>
                        <th>Região</th>
                        <th className="num">Km</th>
                        <th className="num">Peso</th>
                        <th>Entregas</th>
                        <th className="num">Valor</th>
                        <th>Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => {
                        const payment = r.payment_id ? paymentById.get(r.payment_id) : undefined;
                        const canLaunch = !r.payment_id && r.status === 'finished' && r.region_price !== null;
                        return (
                          <tr key={r.id}>
                            <td>{fmtDate(r.day)}</td>
                            <td>{r.driver_name ?? '–'}<small>{r.plate}</small></td>
                            <td>{r.region_name ?? '–'}</td>
                            <td className="num">{fmtKm(r.distance_km)}</td>
                            <td className="num">{fmtKg(r.load_kg)}<small>{fmtKg(r.delivered_kg)} entregues</small></td>
                            <td>
                              {r.delivered} de {r.deliveries}
                              {r.failed > 0 && <small>{plural(r.failed, 'não recebida', 'não recebidas')}</small>}
                            </td>
                            <td className="num">
                              {payment ? fmtBRL(payment.amount) : r.region_price !== null ? fmtBRL(r.region_price) : '–'}
                              {!payment && r.region_price !== null && <small>pela tabela</small>}
                            </td>
                            <td>
                              <RunStatusPill run={r} payment={payment} />
                              {canLaunch && (
                                <Button
                                  type="button"
                                  $variant="secondary"
                                  style={{ height: 32, padding: '0 10px', marginTop: 6, display: 'flex' }}
                                  disabled={launch.isPending}
                                  onClick={() => launch.mutate(r.id)}
                                >
                                  Lançar {fmtBRL(r.region_price!)}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Rows>
                </TableScroll>
              )}
              {runs.some((r) => !r.payment_id && r.status === 'finished') && (
                <Muted style={{ fontSize: 12, marginTop: 8 }}>
                  Rotas encerradas sem nenhuma entrega registrada não entram sozinhas: lance pelo preço da região se o motorista deve
                  receber. “Fora da tabela” é a rota que não caiu em nenhuma região: confira a base e as regiões.
                </Muted>
              )}
            </Card>

            <Card aria-label="Lançamentos">
              <CardTitle style={{ marginBottom: 8 }}>Lançamentos</CardTitle>
              {data && payments.length === 0 && <Muted>Nenhum valor lançado nesse período.</Muted>}
              {payments.length > 0 && (
                <TableScroll>
                  <Rows>
                    <thead>
                      <tr>
                        <th>Motorista</th>
                        <th>Rota</th>
                        <th className="num">Peso</th>
                        <th className="num">Valor</th>
                        <th>Situação</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td>{p.driver_name ?? '–'}</td>
                          <td>
                            {paymentTitle(p)}
                            <small>{p.runs.map((r) => `${fmtKm(r.distance_km)} · ${r.delivered} de ${r.deliveries} entregas`).join(' · ')}</small>
                          </td>
                          <td className="num">{fmtKg(p.runs.reduce((s, r) => s + r.load_kg, 0))}</td>
                          <td className="num"><Money>{fmtBRL(p.amount)}</Money></td>
                          <td>{p.status === 'paid' ? <Pill $tone="success">Pago em {fmtDate(p.paid_on!)}</Pill> : <Pill $tone="warning">A pagar</Pill>}</td>
                          <td className="actions">
                            {p.status === 'pending' ? (
                              <Button type="button" onClick={() => setPaying([p])}>Marcar como pago</Button>
                            ) : (
                              <Button type="button" $variant="secondary" disabled={unpay.isPending} onClick={() => unpay.mutate(p.id)}>Desfazer pagamento</Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Rows>
                </TableScroll>
              )}
            </Card>
          </Stack>
        </>
      )}

      {paying && <PayDialog payments={paying} onClose={() => setPaying(null)} />}
    </>
  );
}
