import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { discard, flushOutbox, useOutbox } from '../offline/outbox';
import { Button } from './ui';

const Box = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: ${({ theme }) => theme.space(2)};
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.cautionTint};
  color: ${({ theme }) => theme.color.cautionInk};
  font-size: ${({ theme }) => theme.font.size.md};

  > div { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  ul { margin: 0; padding-left: 20px; }
  ${Button} { height: 34px; padding: 0 12px; }
`;

/** Registros guardados no celular esperando sinal (e os que a base recusou, com o motivo). */
export function OfflineBanner() {
  const items = useOutbox();
  const [online, setOnline] = useState(navigator.onLine);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const waiting = items.filter((i) => !i.error);
  const refused = items.filter((i) => i.error);
  if (!items.length && online) return null;

  return (
    <Box role="status" aria-live="polite">
      <div>
        <strong>
          {!online ? 'Sem sinal agora. ' : ''}
          {waiting.length
            ? `${waiting.length} ${waiting.length === 1 ? 'registro aguardando envio' : 'registros aguardando envio'}: ${waiting.length === 1 ? 'vai' : 'vão'} sozinho quando o sinal voltar.`
            : !online ? 'Você pode continuar registrando: tudo fica guardado no celular.' : ''}
        </strong>
        {waiting.length > 0 && (
          <Button type="button" $variant="secondary" disabled={sending}
            onClick={() => { setSending(true); flushOutbox().finally(() => setSending(false)); }}>
            {sending ? 'Enviando…' : 'Tentar agora'}
          </Button>
        )}
      </div>
      {waiting.length > 0 && <ul>{waiting.map((i) => <li key={i.id}>{i.label}</li>)}</ul>}
      {refused.map((i) => (
        <div key={i.id}>
          <span>A base não aceitou “{i.label}”: {i.error}</span>
          <Button type="button" $variant="secondary" onClick={() => discard(i.id)}>Descartar</Button>
        </div>
      ))}
    </Box>
  );
}
