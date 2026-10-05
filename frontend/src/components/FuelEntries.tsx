import { useState } from 'react';
import styled from 'styled-components';
import { useAuthImage, useFuelEntries } from '../api/queries';
import type { FuelEntry } from '../api/types';
import { fmtBRL, fmtDate, fmtTime } from '../format';
import { Dialog } from './Dialog';
import { Button, Card, CardTitle, Muted, Table, TableScroll } from './ui';

const Big = styled.img`
  display: block;
  width: 100%;
  max-height: 480px;
  object-fit: contain;
  border-radius: ${({ theme }) => theme.radius};
`;

const liters = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L`;

function Receipt({ entry, onClose }: { entry: FuelEntry | null; onClose: () => void }) {
  const image = useAuthImage(entry ? `/fuel-entries/${entry.id}/photo` : null);
  return (
    <Dialog open={Boolean(entry)} size="small" title={entry ? `Cupom · ${entry.plate}` : 'Cupom'} onClose={onClose}>
      {image.data && <Big src={image.data} alt="Foto do cupom do abastecimento" />}
    </Dialog>
  );
}

/** Gestor: abastecimentos registrados pelos motoristas no período, com o cupom. */
export function FuelEntries({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const entries = useFuelEntries(dateFrom, dateTo);
  const [receipt, setReceipt] = useState<FuelEntry | null>(null);
  const list = entries.data ?? [];
  return (
    <Card aria-label="Abastecimentos">
      <CardTitle style={{ marginBottom: 8 }}>Abastecimentos</CardTitle>
      {entries.isSuccess && list.length === 0 && (
        <Muted>Nenhum abastecimento registrado no período. O motorista registra em Minha rota → Abastecer, com a foto do cupom.</Muted>
      )}
      {list.length > 0 && (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Veículo</th>
                <th>Motorista</th>
                <th>Litros</th>
                <th>Valor</th>
                <th>R$/litro</th>
                <th>Hodômetro</th>
                <th>Posto</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDate(e.filled_at.slice(0, 10))} {fmtTime(e.filled_at)}</td>
                  <td>{e.plate}</td>
                  <td>{e.driver_name}</td>
                  <td>{liters(e.liters)}{e.full_tank ? '' : ' (parcial)'}</td>
                  <td>{fmtBRL(e.total)}</td>
                  <td>{fmtBRL(e.price_per_liter, 3)}</td>
                  <td>{e.odometer_km !== null ? `${e.odometer_km.toLocaleString('pt-BR')} km` : '–'}</td>
                  <td>{e.station ?? '–'}</td>
                  <td><Button type="button" $variant="secondary" style={{ height: 32, padding: '0 10px' }} onClick={() => setReceipt(e)}>Cupom</Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
      <Receipt entry={receipt} onClose={() => setReceipt(null)} />
    </Card>
  );
}
