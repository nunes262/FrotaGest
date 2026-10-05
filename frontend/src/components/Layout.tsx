import { useCallback, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { DEV_TOOLS, useConversations, useCurrentRun, useVehicles } from '../api/queries';
import { useRealtime } from '../api/realtime';
import type { DeliveriesAssigned, DeliveryOutcomeNotice, PaymentsChanged } from '../api/types';
import { fmtBRL } from '../format';
import { useAuth } from '../auth/AuthContext';
import { DevOptions } from './DevOptions';
import { Icon, type IconName } from './Icon';
import { LoadReceivedDialog } from './LoadReceivedDialog';
import { REASON_LABEL } from './Proof';
import { RunGpsProvider } from './RunGps';
import { Toasts, type Toast } from './Toasts';
import { OfflineBanner } from './OfflineBanner';
import { useOutboxSync } from '../offline/outbox';
import { CountBadge, IconButton, SrOnly } from './ui';
import { blankVehicleFields } from './VehicleFields';

const Shell = styled.div`
  display: flex;
  flex-wrap: wrap;
  min-height: 100%;
`;

const Nav = styled.nav`
  flex: 1 1 220px;
  max-width: 260px;
  background: ${({ theme }) => theme.color.surface};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: ${({ theme }) => `${theme.space(3)} ${theme.space(2)}`};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(1)};

  @media (max-width: 720px) {
    max-width: none;
    flex-basis: 100%;
  }
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space(1)};
  padding: ${({ theme }) => `0 ${theme.space(1)} ${theme.space(3)}`};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  font-size: ${({ theme }) => theme.font.size.xl};
  color: ${({ theme }) => theme.color.textStrong};
`;

const Mark = styled.span`
  width: 32px;
  height: 32px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.primary};
  color: ${({ theme }) => theme.color.textInvert};
  display: grid;
  place-items: center;
  font-size: ${({ theme }) => theme.font.size.md};
`;

const Item = styled(NavLink)`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space(2)};
  padding: 12px;
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.color.text};
  text-decoration: none;
  font-size: ${({ theme }) => theme.font.size.md};

  &:hover { background: ${({ theme }) => theme.color.background}; }
  &.active {
    background: ${({ theme }) => theme.color.primaryTint};
    color: ${({ theme }) => theme.color.primary};
    font-weight: ${({ theme }) => theme.font.weight.semibold};
  }
`;

const Footer = styled.div`
  margin-top: auto;
  padding-top: ${({ theme }) => theme.space(2)};
  border-top: 1px solid ${({ theme }) => theme.color.border};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space(1)};

  div { flex-grow: 1; display: flex; flex-direction: column; min-width: 0; }
  strong { font-size: ${({ theme }) => theme.font.size.md}; }
  span { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const LiveDot = styled.span`
  width: 10px;
  height: 10px;
  margin-left: auto;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${({ theme }) => theme.color.success};
  box-shadow: 0 0 0 3px ${({ theme }) => theme.color.successTint};
`;

const AlertDot = styled.span`
  width: 20px;
  height: 20px;
  margin-left: auto;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${({ theme }) => theme.color.caution};
  color: ${({ theme }) => theme.color.textStrong};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  display: grid;
  place-items: center;
`;

const Main = styled.main`
  flex: 999 1 560px;
  min-width: 0;
  padding: ${({ theme }) => theme.space(4)};
  max-width: 1320px;

  @media (max-width: 720px) { padding: ${({ theme }) => theme.space(2)}; }
`;

const adminLinks: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Painel e mapa', icon: 'map' },
  { to: '/rotas', label: 'Rotas por motorista', icon: 'route' },
  { to: '/carregamento', label: 'Carregamento', icon: 'truck' },
  { to: '/motoristas', label: 'Motoristas', icon: 'users' },
  { to: '/veiculos', label: 'Veículos', icon: 'car' },
  { to: '/custos', label: 'Custos da frota', icon: 'money' },
  { to: '/pagamentos', label: 'Pagamentos', icon: 'wallet' },
  { to: '/chat', label: 'Chat', icon: 'chat' },
  { to: '/configuracoes', label: 'Configurações', icon: 'settings' },
];
const driverLinks: typeof adminLinks = [
  { to: '/minha-rota', label: 'Minha rota', icon: 'navigation' },
  { to: '/rotas-feitas', label: 'Rotas feitas', icon: 'clipboard' },
  { to: '/meu-veiculo', label: 'Meu veículo', icon: 'truck' },
  { to: '/chat', label: 'Chat com a base', icon: 'chat' },
];

/** Soma os avisos que chegam enquanto o modal ainda está aberto. */
function mergeNotices(current: DeliveriesAssigned | null, next: DeliveriesAssigned): DeliveriesAssigned {
  if (!current) return next;
  return {
    day: current.day < next.day ? current.day : next.day,
    count: current.count + next.count,
    weight_kg: current.weight_kg + next.weight_kg,
    assigned_by: next.assigned_by,
  };
}

const TOAST_MS = 8_000;

function outcomeToast(n: DeliveryOutcomeNotice): Omit<Toast, 'id'> {
  return n.outcome === 'delivered'
    ? { tone: 'success', title: `Entregue: ${n.customer_name}`, text: `${n.driver_name} enviou a foto do comprovante.` }
    : { tone: 'danger', title: `Não entregue: ${n.customer_name}`, text: `${REASON_LABEL[n.reason ?? 'other']} · ${n.driver_name}` };
}

/** Aviso para o motorista quando a base lança um valor ou registra um pagamento. */
function paymentToast(n: PaymentsChanged): Omit<Toast, 'id'> | null {
  const routes = n.count === 1 ? 'Preço da região da sua rota' : `${n.count} rotas pela tabela de regiões`;
  if (n.kind === 'created') return { tone: 'success', title: `Novo valor a receber: ${fmtBRL(n.amount)}`, text: routes, to: '/rotas-feitas' };
  if (n.kind === 'paid') return { tone: 'success', title: `Pagamento registrado: ${fmtBRL(n.amount)}`, text: 'A base marcou como pago.', to: '/rotas-feitas' };
  return null;
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isDriver = user?.role === 'driver';
  const activeRun = useCurrentRun(isDriver).data ?? null;
  const links = isDriver ? driverLinks : adminLinks;
  const [loadNotice, setLoadNotice] = useState<DeliveriesAssigned | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const toast = (t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-3), { id, ...t }]);
    window.setTimeout(() => dismiss(id), TOAST_MS);
  };
  useRealtime(Boolean(user), {
    onDeliveriesAssigned: (notice) => isDriver && setLoadNotice((current) => mergeNotices(current, notice)),
    onDeliveryOutcome: (notice) => !isDriver && toast(outcomeToast(notice)),
    onPaymentsChanged: (notice) => {
      const t = isDriver ? paymentToast(notice) : null;
      if (t) toast(t);
    },
    onExpenseSubmitted: (n) =>
      !isDriver && toast({ tone: 'success', title: `Despesa para aprovar: ${fmtBRL(n.amount)}`, text: `${n.kind_label} · ${n.driver_name}`, to: '/pagamentos' }),
    onExpenseReviewed: (n) =>
      isDriver && toast(n.approved
        ? { tone: 'success', title: `Despesa aprovada: ${fmtBRL(n.amount)}`, text: `${n.kind_label}: entra no seu “A receber”.`, to: '/rotas-feitas' }
        : { tone: 'danger', title: `Despesa recusada: ${fmtBRL(n.amount)}`, text: n.reason ?? n.kind_label, to: '/rotas-feitas' }),
    onChecklistIssues: (n) =>
      !isDriver && toast({ tone: 'danger', title: `Saiu com ${n.issues} ${n.issues === 1 ? 'pendência' : 'pendências'} no checklist`, text: `${n.driver_name} · ${n.plate}`, to: '/carregamento' }),
  });
  // Registros feitos sem sinal vão sozinhos quando o sinal volta
  const onSent = useCallback((count: number) => toast({ tone: 'success', title: 'Sinal de volta', text: `${count} ${count === 1 ? 'registro enviado' : 'registros enviados'} para a base.` }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useOutboxSync(isDriver, onSent);
  const unread = useConversations().data?.reduce((total, c) => total + c.unread_count, 0) ?? 0;
  // Motorista sem veículo, ou com dados que a base deixou em branco: avisa no menu
  const vehicles = useVehicles(isDriver);
  const vehicleIncomplete =
    isDriver && vehicles.isSuccess && (vehicles.data.length === 0 || blankVehicleFields(vehicles.data[0]).length > 0);

  return (
    <RunGpsProvider runId={activeRun?.id ?? null}>
      <Shell>
        <Nav aria-label="Menu principal">
          <Brand><Mark>FG</Mark>FrotaGest</Brand>
          {links.map((l) => (
            <Item key={l.to} to={l.to} end={l.to === '/'}>
              <Icon name={l.icon} />
              {l.label}
              {l.to === '/chat' && unread > 0 && (
                <>
                  <CountBadge aria-hidden="true" style={{ marginLeft: 'auto' }}>{unread}</CountBadge>
                  <SrOnly>, {unread} não lidas</SrOnly>
                </>
              )}
              {l.to === '/minha-rota' && activeRun && (
                <>
                  <LiveDot aria-hidden="true" />
                  <SrOnly>, ativa</SrOnly>
                </>
              )}
              {l.to === '/meu-veiculo' && vehicleIncomplete && (
                <>
                  <AlertDot aria-hidden="true">!</AlertDot>
                  <SrOnly>, faltam informações</SrOnly>
                </>
              )}
            </Item>
          ))}
          {DEV_TOOLS && <div style={{ marginTop: 'auto' }}><DevOptions /></div>}
          <Footer style={DEV_TOOLS ? { marginTop: 0 } : undefined}>
            <div>
              <strong>{user?.name}</strong>
              <span>{user?.role === 'admin' ? 'Gestor' : 'Motorista'}</span>
            </div>
            <IconButton type="button" aria-label="Sair" onClick={() => { logout(); navigate('/login'); }}>
              <Icon name="logout" />
            </IconButton>
          </Footer>
        </Nav>
        <Main>
          {isDriver && <OfflineBanner />}
          <Outlet />
        </Main>
        <LoadReceivedDialog
          notice={loadNotice}
          onClose={() => setLoadNotice(null)}
          onView={() => {
            setLoadNotice(null);
            // Em "Minha rota": vira a próxima rota, entra nas próximas cargas ou, com a rota em andamento, pede para recalcular
            navigate('/minha-rota');
          }}
        />
        <Toasts toasts={toasts} onDismiss={dismiss} onOpen={(t) => navigate(t.to ?? '/carregamento')} />
      </Shell>
    </RunGpsProvider>
  );
}
