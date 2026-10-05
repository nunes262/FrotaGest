import styled from 'styled-components';
import type { Delivery } from '../api/types';
import { fmtKg } from '../format';
import { Muted } from './ui';

type LoadTone = 'success' | 'caution' | 'danger';

export const sumKg = (list: Delivery[]) => list.reduce((total, d) => total + d.weight_kg, 0);

/** Peso que ainda está no caminhão: o que já foi entregue sai, e o não recebido sai quando a rota volta para a base. */
export const onBoardKg = (list: Delivery[]) => sumKg(list.filter((d) => d.on_board));

const MeterText = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 8px;
  margin-bottom: 6px;
  font-size: ${({ theme }) => theme.font.size.sm};
`;

const ToneText = styled.span<{ $tone: LoadTone }>`
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme, $tone }) => ({ success: theme.color.successInk, caution: theme.color.cautionInk, danger: theme.color.dangerInk })[$tone]};
`;

const Track = styled.div`
  position: relative;
  height: 8px;
  border-radius: 4px;
  background: ${({ theme }) => theme.color.neutralTint};
  overflow: hidden;
`;

const Fill = styled.span<{ $tone: LoadTone; $pct: number; $ghost?: boolean }>`
  position: absolute;
  inset: 0 auto 0 0;
  width: ${({ $pct }) => $pct}%;
  border-radius: 4px;
  background: ${({ theme, $tone }) => ({ success: theme.color.success, caution: theme.color.caution, danger: theme.color.danger })[$tone]};
  opacity: ${({ $ghost }) => ($ghost ? 0.35 : 1)};
  transition: width 250ms ease;
`;

function loadTone(kg: number, capacity: number): LoadTone {
  if (kg > capacity) return 'danger';
  return kg > capacity * 0.9 ? 'caution' : 'success';
}

interface Props {
  loadedKg: number;
  /** Peso das entregas marcadas que ainda vão entrar (mostrado mais claro). */
  selectedKg?: number;
  capacityKg: number | null;
}

/** Peso no caminhão comparado com a capacidade do veículo. */
export function LoadMeter({ loadedKg, selectedKg = 0, capacityKg }: Props) {
  if (!capacityKg) return <Muted>{fmtKg(loadedKg)} no caminhão · capacidade do veículo não informada</Muted>;
  const after = loadedKg + selectedKg;
  const pct = (kg: number) => Math.min(100, (kg / capacityKg) * 100);
  return (
    <div>
      <MeterText>
        <span>{fmtKg(loadedKg)} no caminhão, de {fmtKg(capacityKg)}</span>
        {selectedKg > 0 && (
          <ToneText $tone={loadTone(after, capacityKg)}>
            {after > capacityKg ? `Passa ${fmtKg(after - capacityKg)} da capacidade` : `Com as marcadas: ${fmtKg(after)}`}
          </ToneText>
        )}
        {selectedKg === 0 && loadedKg > capacityKg && (
          <ToneText $tone="danger">Passa {fmtKg(loadedKg - capacityKg)} da capacidade</ToneText>
        )}
      </MeterText>
      <Track
        role="meter"
        aria-label="Peso no caminhão"
        aria-valuemin={0}
        aria-valuemax={capacityKg}
        aria-valuenow={loadedKg}
        aria-valuetext={`${fmtKg(loadedKg)} de ${fmtKg(capacityKg)}`}
      >
        {selectedKg > 0 && <Fill $tone={loadTone(after, capacityKg)} $pct={pct(after)} $ghost />}
        <Fill $tone={loadTone(loadedKg, capacityKg)} $pct={pct(loadedKg)} />
      </Track>
    </div>
  );
}
