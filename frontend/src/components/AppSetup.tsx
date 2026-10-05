import { useState } from 'react';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useInstall, usePush } from '../pwa';
import { Icon } from './Icon';
import { Button, Card, CardTitle, ErrorText, Muted, SuccessText } from './ui';

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space(1)};
  padding: 10px 0;
  border-top: 1px solid ${({ theme }) => theme.color.border};
  ${Button} { height: 40px; }
`;

const DISMISS_KEY = 'frotagest.appSetupDismissed';

function dismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Avisos no celular (mesmo com o app fechado) e instalar o app na tela inicial. */
export function AppSetupCard({ alwaysShow = false, text }: { alwaysShow?: boolean; text: string }) {
  const push = usePush();
  const install = useInstall();
  const [hidden, setHidden] = useState(dismissed);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pushDone = !push.supported || push.subscribed === true;
  const installDone = install.installed || (!install.canInstall && !install.showIosHint);
  if (push.subscribed === null && push.supported) return null; // ainda conferindo
  if (!alwaysShow && (hidden || (pushDone && installDone))) return null;

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      await push.enable();
    } catch (e) {
      setError(e instanceof Error && !('isAxiosError' in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card aria-label="Avisos e app">
      <CardTitle>Avisos no celular</CardTitle>
      <Muted style={{ margin: '4px 0 8px' }}>{text}</Muted>
      <Row>
        <span>Notificações com o app fechado</span>
        {!push.supported ? (
          <Muted style={{ fontSize: 12 }}>Este navegador não recebe notificações{install.showIosHint ? ' (no iPhone, instale o app primeiro)' : ''}.</Muted>
        ) : push.subscribed ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SuccessText as="span" style={{ padding: '4px 10px' }}>Ativadas</SuccessText>
            {alwaysShow && <Button type="button" $variant="secondary" disabled={busy} onClick={() => push.disable()}>Desativar</Button>}
          </span>
        ) : push.permission === 'denied' ? (
          <Muted style={{ fontSize: 12 }}>Bloqueadas no navegador: libere nas configurações do site.</Muted>
        ) : (
          <Button type="button" disabled={busy} onClick={enable}>
            <Icon name="alert" size={18} />
            {busy ? 'Ativando…' : 'Ativar avisos'}
          </Button>
        )}
      </Row>
      <Row>
        <span>App na tela inicial</span>
        {install.installed ? (
          <SuccessText as="span" style={{ padding: '4px 10px' }}>Instalado</SuccessText>
        ) : install.canInstall ? (
          <Button type="button" $variant="secondary" onClick={() => install.install()}>Instalar o app</Button>
        ) : install.showIosHint ? (
          <Muted style={{ fontSize: 12 }}>No iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.</Muted>
        ) : (
          <Muted style={{ fontSize: 12 }}>Abra pelo Chrome do celular para instalar.</Muted>
        )}
      </Row>
      {error && <ErrorText role="alert">{error}</ErrorText>}
      {!alwaysShow && (
        <Button type="button" $variant="secondary" style={{ height: 32, marginTop: 8 }}
          onClick={() => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* sem armazenamento: some só agora */ } setHidden(true); }}>
          Agora não
        </Button>
      )}
    </Card>
  );
}
