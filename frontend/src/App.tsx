import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { RequireAuth, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { ChatPage } from './pages/ChatPage';
import { DashboardPage } from './pages/DashboardPage';
import { DispatchPage } from './pages/DispatchPage';
import { DriversPage } from './pages/DriversPage';
import { LoginPage } from './pages/LoginPage';
import { MyVehiclePage } from './pages/MyVehiclePage';
import { RunPage } from './pages/RunPage';
import { CostsPage } from './pages/CostsPage';
import { VehiclesPage } from './pages/VehiclesPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { RouteHistoryPage } from './pages/RouteHistoryPage';
import { RoutesPage } from './pages/RoutesPage';
import { SettingsPage } from './pages/SettingsPage';

/** Os pneus agora ficam numa aba da tela de Veículos. */
function TiresRedirect() {
  const [params] = useSearchParams();
  const vehicle = params.get('veiculo');
  return <Navigate to={`/veiculos?aba=pneus${vehicle ? `&veiculo=${vehicle}` : ''}`} replace />;
}

function Home() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <DashboardPage /> : <Navigate to="/minha-rota" replace />;
}

/** O gestor vê as rotas por motorista; o motorista, as rotas feitas (com as entregas e o valor). */
function RoutesHome() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <RoutesPage /> : <Navigate to="/rotas-feitas" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Home />} />
        <Route path="rotas" element={<RoutesHome />} />
        <Route path="carregamento" element={<RequireAuth role="admin"><DispatchPage /></RequireAuth>} />
        <Route path="motoristas" element={<RequireAuth role="admin"><DriversPage /></RequireAuth>} />
        {/* Telas antigas do motorista: carregamentos e rota em andamento viraram "Minha rota"; entregas feitas e a receber, "Rotas feitas" */}
        <Route path="meus-carregamentos" element={<Navigate to="/minha-rota" replace />} />
        <Route path="minhas-entregas" element={<Navigate to="/rotas-feitas" replace />} />
        <Route path="a-receber" element={<Navigate to="/rotas-feitas" replace />} />
        <Route path="meu-veiculo" element={<RequireAuth role="driver"><MyVehiclePage /></RequireAuth>} />
        <Route path="minha-rota" element={<RequireAuth role="driver"><RunPage /></RequireAuth>} />
        <Route path="meus-pneus" element={<Navigate to="/meu-veiculo#pneus" replace />} />
        <Route path="pneus" element={<RequireAuth role="admin"><TiresRedirect /></RequireAuth>} />
        <Route path="veiculos" element={<RequireAuth role="admin"><VehiclesPage /></RequireAuth>} />
        <Route path="custos" element={<RequireAuth role="admin"><CostsPage /></RequireAuth>} />
        <Route path="pagamentos" element={<RequireAuth role="admin"><PaymentsPage /></RequireAuth>} />
        <Route path="rotas-feitas" element={<RequireAuth role="driver"><RouteHistoryPage /></RequireAuth>} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="configuracoes" element={<RequireAuth role="admin"><SettingsPage /></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
