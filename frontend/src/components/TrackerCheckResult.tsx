import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import type { TrackerCheck } from '../api/types';
import { fmtDate, fmtTime, localDateISO } from '../format';

const Box = styled.p<{ $tone: 'success' | 'caution' | 'danger' }>`
  margin: 6px 0 0;
  padding: 8px 12px;
  border-radius: ${({ theme }) => theme.radius};
  font-size: ${({ theme }) => theme.font.size.sm};
  background: ${({ theme, $tone }) => ({ success: theme.color.successTint, caution: theme.color.cautionTint, danger: theme.color.dangerTint })[$tone]};
  color: ${({ theme, $tone }) => ({ success: theme.color.successInk, caution: theme.color.cautionInk, danger: theme.color.dangerInk })[$tone]};
`;

/** Resposta do "Verificar rastreador": está transmitindo, em silêncio, não liberado ou erro. */
export function TrackerCheckResult({ result, error }: { result?: TrackerCheck; error?: unknown }) {
  if (error) {
    const text = errorMessage(error);
    return (
      <Box $tone="danger" role="alert">
        {text}
        {/credenciais/i.test(text) && <> <Link to="/configuracoes">Conectar o rastreador</Link></>}
      </Box>
    );
  }
  if (!result) return null;
  if (result.status === 'not_integrated') {
    return (
      <Box $tone="caution" role="status">
        O código {result.external_id} não está liberado para a sua integração. Peça ao rastreador para incluir o veículo.
      </Box>
    );
  }
  if (result.status === 'silent' || !result.last) {
    return (
      <Box $tone="caution" role="status">
        Nenhuma posição nas últimas 24 h: rastreador desligado, sem sinal ou veículo parado sem transmitir.
      </Box>
    );
  }
  const { last } = result;
  return (
    <Box $tone="success" role="status">
      Transmitindo: última posição em {fmtDate(localDateISO(last.recorded_at))} às {fmtTime(last.recorded_at)}
      {last.address ? ` · ${last.address}` : ''} · {Math.round(last.speed_kmh)} km/h, ignição {last.ignition ? 'ligada' : 'desligada'}.
      {result.stored > 0 && ` ${result.stored} posições novas no mapa.`}
    </Box>
  );
}
