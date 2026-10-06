import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom';
import styled, { css } from 'styled-components';
import { DEV_TOOLS, useConversations, useCurrentRun, useVehicles } from '../api/queries';
import { useRealtime } from '../api/realtime';
import type { DeliveriesAssigned, DeliveryOutcomeNotice, PaymentsChanged } from '../api/types';
import { fmtBRL } from '../format';
import { useAuth } from '../auth/AuthContext';
import { DevOptions } from './DevOptions';
import { Dialog } from './Dialog';
import { Icon, type IconName } from './Icon';
import { LoadReceivedDialog } from './LoadReceivedDialog';
import { REASON_LABEL } from './Proof';
import { RunGpsProvider } from './RunGps';
import { Toasts, type Toast } from './Toasts';
import { OfflineBanner } from './OfflineBanner';
import { useOutboxSync } from '../offline/outbox';
import { Button, CountBadge, IconButton, SrOnly } from './ui';
import { blankVehicleFields } from './VehicleFields';

// A tela inteira tem a altura da janela: o menu fica parado e só o conteúdo rola
const Shell = styled.div`
  display: flex;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  padding: 0 env(safe-area-inset-right) 0 env(safe-area-inset-left);

  @media ${({ theme }) => theme.media.compact} { flex-direction: column; }
`;

const Sidebar = styled.nav`
  flex: 0 0 256px;
  min-height: 0;
  z-index: 1;
  background: ${({ theme }) => theme.color.surface};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: ${({ theme }) => `${theme.space(3)} ${theme.space(2)}`};
  display: flex;
  flex-direction: column;

  @media ${({ theme }) => theme.media.compact} { display: none; }
`;

/** Lista de telas: rola sozinha se a janela for baixa, sem esconder a marca nem o rodapé. */
const NavLinks = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(1)};
  /* espaço para o contorno de foco não ser cortado pela rolagem */
  margin: 0 -4px;
  padding: 2px 4px;
  /* Sombra nas bordas só quando há mais telas para rolar */
  background:
    linear-gradient(${({ theme }) => theme.color.surface} 30%, transparent) top / 100% 24px no-repeat local,
    linear-gradient(transparent, ${({ theme }) => theme.color.surface} 70%) bottom / 100% 24px no-repeat local,
    radial-gradient(farthest-side at 50% 0, rgba(0, 0, 0, 0.14), transparent) top / 100% 8px no-repeat scroll,
    radial-gradient(farthest-side at 50% 100%, rgba(0, 0, 0, 0.14), transparent) bottom / 100% 8px no-repeat scroll;
`;

const SidebarBottom = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(1)};
  padding-top: ${({ theme }) => theme.space(1)};
`;

const Brand = styled.div`
  flex-shrink: 0;
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
  display: block;
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${({ theme }) => theme.color.success};
  box-shadow: 0 0 0 3px ${({ theme }) => theme.color.successTint};
`;

const AlertDot = styled.span`
  width: 20px;
  height: 20px;
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
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
`;

const Content = styled.div`
  max-width: 1320px;
  padding: ${({ theme }) => theme.space(4)};

  @media (max-width: 720px) { padding: ${({ theme }) => theme.space(2)}; }
`;

/** Ao lado do texto (menu lateral e folha "Mais"): empurra o aviso para a direita. */
const RowMark = styled.span`
  margin-left: auto;
  display: flex;
`;

/** Em cima do ícone (barra de abas). */
const IconMark = styled.span`
  position: absolute;
  top: -4px;
  left: calc(50% + 4px);
  display: flex;
`;

const TabBar = styled.nav`
  display: none;

  @media ${({ theme }) => theme.media.compact} {
    display: flex;
    flex-shrink: 0;
    height: calc(${({ theme }) => theme.tabBarHeight} + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: ${({ theme }) => theme.color.surface};
    border-top: 1px solid ${({ theme }) => theme.color.border};
  }
`;

const tab = css`
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0 2px;
  color: ${({ theme }) => theme.color.textSoft};
  text-decoration: none;
  font-size: 11px;
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; outline-offset: -4px; }
`;

const TabLabel = styled.span`
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TabIcon = styled.span`
  position: relative;
  display: grid;
  place-items: center;
  width: 56px;
  height: 30px;
  border-radius: 15px;
  transition: background 150ms ease;
`;

const activeTab = css`
  color: ${({ theme }) => theme.color.primary};
  ${TabIcon} { background: ${({ theme }) => theme.color.primaryTint}; }
`;

const Tab = styled(NavLink)`
  ${tab}
  &.active { ${activeTab} }
`;

const MoreTab = styled.button<{ $active: boolean }>`
  all: unset;
  box-sizing: border-box;
  ${tab}
  ${({ $active }) => $active && activeTab}
`;

const SheetUser = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0 12px ${({ theme }) => theme.space(2)};
  margin-bottom: ${({ theme }) => theme.space(1)};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  strong { font-size: ${({ theme }) => theme.font.size.lg}; color: ${({ theme }) => theme.color.textStrong}; }
  span { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const SheetList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(1)};
  margin-bottom: ${({ theme }) => theme.space(2)};
  > ${Button} { margin-top: ${({ theme }) => theme.space(1)}; }
`;

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Nome curto e lugar na barra de abas do celular; as outras telas ficam em "Mais" */
  tab?: string;
}

const adminLinks: NavItem[] = [
  { to: '/', label: 'Painel e mapa', icon: 'map', tab: 'Painel' },
  { to: '/rotas', label: 'Rotas por motorista', icon: 'route', tab: 'Rotas' },
  { to: '/carregamento', label: 'Carregamento', icon: 'truck', tab: 'Cargas' },
  { to: '/motoristas', label: 'Motoristas', icon: 'users' },
  { to: '/veiculos', label: 'Veículos', icon: 'car' },
  { to: '/custos', label: 'Custos da frota', icon: 'money' },
  { to: '/pagamentos', label: 'Pagamentos', icon: 'wallet' },
  { to: '/chat', label: 'Chat', icon: 'chat', tab: 'Chat' },
  { to: '/configuracoes', label: 'Configurações', icon: 'settings' },
];
const driverLinks: NavItem[] = [
  { to: '/minha-rota', label: 'Minha rota', icon: 'navigation', tab: 'Minha rota' },
  { to: '/rotas-feitas', label: 'Rotas feitas', icon: 'clipboard', tab: 'Histórico' },
  { to: '/meu-veiculo', label: 'Meu veículo', icon: 'truck', tab: 'Veículo' },
  { to: '/chat', label: 'Chat com a base', icon: 'chat', tab: 'Chat' },
];

/** Aviso que aparece junto de uma tela no menu: contador, ponto verde ou alerta. */
type NavMark = { kind: 'count'; value: number; label: string } | { kind: 'live'; label: string } | { kind: 'alert'; label: string };

function MarkBadge({ mark }: { mark: NavMark }) {
  if (mark.kind === 'count') return <CountBadge aria-hidden="true">{mark.value}</CountBadge>;
  if (mark.kind === 'live') return <LiveDot aria-hidden="true" />;
  return <AlertDot aria-hidden="true">!</AlertDot>;
}

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

  const marks: Record<string, NavMark | undefined> = {
    '/chat': unread > 0 ? { kind: 'count', value: unread, label: `${unread} não lidas` } : undefined,
    '/minha-rota': activeRun ? { kind: 'live', label: 'ativa' } : undefined,
    '/meu-veiculo': vehicleIncomplete ? { kind: 'alert', label: 'faltam informações' } : undefined,
  };
  const tabs = links.filter((l) => l.tab);
  const more = links.filter((l) => !l.tab);
  const { pathname } = useLocation();
  const inMore = more.some((l) => matchPath({ path: l.to, end: l.to === '/' }, pathname));
  const moreMark = more.map((l) => marks[l.to]).find(Boolean);
  const [menuOpen, setMenuOpen] = useState(false);

  // Cada tela começa do topo, e o menu do celular fecha ao trocar de tela
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    setMenuOpen(false);
  }, [pathname]);

  const signOut = () => {
    logout();
    navigate('/login');
  };
  const roleName = user?.role === 'admin' ? 'Gestor' : 'Motorista';
  const rowLink = (l: NavItem, onClick?: () => void) => {
    const mark = marks[l.to];
    return (
      <Item key={l.to} to={l.to} end={l.to === '/'} onClick={onClick}>
        <Icon name={l.icon} />
        {l.label}
        {mark && (
          <>
            <RowMark><MarkBadge mark={mark} /></RowMark>
            <SrOnly>, {mark.label}</SrOnly>
          </>
        )}
      </Item>
    );
  };

  return (
    <RunGpsProvider runId={activeRun?.id ?? null}>
      <Shell>
        <Sidebar aria-label="Menu principal">
          <Brand><Mark>FG</Mark>FrotaGest</Brand>
          <NavLinks>{links.map((l) => rowLink(l))}</NavLinks>
          <SidebarBottom>
            {DEV_TOOLS && <DevOptions />}
            <Footer>
              <div>
                <strong>{user?.name}</strong>
                <span>{roleName}</span>
              </div>
              <IconButton type="button" aria-label="Sair" onClick={signOut}>
                <Icon name="logout" />
              </IconButton>
            </Footer>
          </SidebarBottom>
        </Sidebar>
        <Main ref={mainRef}>
          <Content>
            {isDriver && <OfflineBanner />}
            <Outlet />
          </Content>
        </Main>
        <TabBar aria-label="Menu principal">
          {tabs.map((l) => {
            const mark = marks[l.to];
            return (
              <Tab key={l.to} to={l.to} end={l.to === '/'}>
                <TabIcon>
                  <Icon name={l.icon} />
                  {mark && <IconMark><MarkBadge mark={mark} /></IconMark>}
                </TabIcon>
                <TabLabel>{l.tab}</TabLabel>
                {mark && <SrOnly>, {mark.label}</SrOnly>}
              </Tab>
            );
          })}
          <MoreTab type="button" $active={inMore || menuOpen} aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>
            <TabIcon>
              <Icon name="menu" />
              {moreMark && <IconMark><MarkBadge mark={moreMark} /></IconMark>}
            </TabIcon>
            <TabLabel>Mais</TabLabel>
            {moreMark && <SrOnly>, {moreMark.label}</SrOnly>}
          </MoreTab>
        </TabBar>
        <Dialog open={menuOpen} title="Menu" placement="sheet" onClose={() => setMenuOpen(false)}>
          <SheetUser>
            <strong>{user?.name}</strong>
            <span>{roleName}</span>
          </SheetUser>
          <SheetList>
            {more.map((l) => rowLink(l, () => setMenuOpen(false)))}
            {DEV_TOOLS && <DevOptions />}
            <Button type="button" $variant="secondary" onClick={signOut}>
              <Icon name="logout" size={20} />
              Sair
            </Button>
          </SheetList>
        </Dialog>
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
