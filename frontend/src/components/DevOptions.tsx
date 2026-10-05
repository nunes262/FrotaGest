import { useState } from 'react';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import {
  useDrivers,
  useResetTest,
  useSetSimulation,
  useSimulations,
  useSkipStop,
  useStopSimulation,
  useVehicles,
} from '../api/queries';
import type { Simulation, SimulationSettings, Vehicle } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { fmtKm, plural } from '../format';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { Button, ErrorText, FieldLabel, Muted, Pill, Select, SrOnly, SuccessText } from './ui';

const SPEEDS = [
  { value: 1, label: 'Tempo real' },
  { value: 5, label: '5x' },
  { value: 10, label: '10x' },
  { value: 30, label: '30x' },
  { value: 60, label: '60x' },
];
const CRUISE_KMH = [20, 30, 40, 60, 80];
const DWELL_MIN = [0, 1, 3, 5, 10];
const EXAMPLE_KM = 30;

const OpenButton = styled.button`
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space(2)};
  padding: 10px 12px;
  border: 1px dashed ${({ theme }) => theme.color.borderStrong};
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.md};
  cursor: pointer;
  &:hover { background: ${({ theme }) => theme.color.background}; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; }
`;

const DevTag = styled.span`
  margin-left: auto;
  padding: 2px 6px;
  border-radius: 4px;
  background: ${({ theme }) => theme.color.textStrong};
  color: ${({ theme }) => theme.color.textInvert};
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  letter-spacing: 0.04em;
`;

const RunningDot = styled.span`
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${({ theme }) => theme.color.success};
  box-shadow: 0 0 0 3px ${({ theme }) => theme.color.successTint};
`;

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(3)};
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
  padding: ${({ theme }) => theme.space(2)};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius};

  h3 { font-size: ${({ theme }) => theme.font.size.lg}; }
  ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; font-size: ${({ theme }) => theme.font.size.md}; }
`;

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space(1)};
`;

const Switch = styled.label`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.space(1)};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  cursor: pointer;

  input {
    appearance: none;
    width: 44px;
    height: 24px;
    margin: 0;
    border-radius: 12px;
    background: ${({ theme }) => theme.color.borderStrong};
    position: relative;
    cursor: pointer;
    transition: background 150ms ease;
  }
  input::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    transition: transform 150ms ease;
  }
  input:checked { background: ${({ theme }) => theme.color.success}; }
  input:checked::after { transform: translateX(20px); }
  input:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; outline-offset: 2px; }
  input:disabled { opacity: 0.6; }
`;

const Status = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.background};

  strong { color: ${({ theme }) => theme.color.textStrong}; }
`;

const Bar = styled.div<{ $pct: number }>`
  height: 8px;
  border-radius: 4px;
  background: ${({ theme }) => theme.color.border};
  overflow: hidden;
  &::after {
    content: '';
    display: block;
    height: 100%;
    width: ${({ $pct }) => $pct}%;
    background: ${({ theme }) => theme.color.success};
    transition: width 400ms ease;
  }
`;

const Setting = styled.fieldset`
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;

  legend { padding: 0; margin-bottom: 6px; font-size: ${({ theme }) => theme.font.size.md}; font-weight: ${({ theme }) => theme.font.weight.semibold}; }
`;

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const Chip = styled.button<{ $active: boolean }>`
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  border: 1.5px solid ${({ theme }) => theme.color.primary};
  background: ${({ theme, $active }) => ($active ? theme.color.primary : theme.color.surface)};
  color: ${({ theme, $active }) => ($active ? theme.color.textInvert : theme.color.primary)};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  cursor: pointer;
  &:disabled { opacity: 0.6; cursor: default; }
`;

const Check = styled.label`
  display: flex;
  align-items: flex-start;
  gap: ${({ theme }) => theme.space(1)};
  cursor: pointer;

  input { width: 18px; height: 18px; margin: 2px 0 0; accent-color: ${({ theme }) => theme.color.primary}; flex-shrink: 0; }
  span { display: flex; flex-direction: column; gap: 2px; }
  strong { font-size: ${({ theme }) => theme.font.size.md}; }
  small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.space(1)};
  ${Button} { height: 40px; }
`;

/** Minutos de relógio que a rota leva com esses ajustes. */
function clockMinutes(km: number, stops: number, s: SimulationSettings) {
  return ((km / s.cruise_kmh) * 60 + stops * s.dwell_min) / s.speed_factor;
}

const fmtClock = (minutes: number) =>
  minutes < 1 ? `${Math.max(1, Math.round(minutes * 60))} s` : minutes < 60 ? `${Math.round(minutes)} min` : `${Math.floor(minutes / 60)}h${String(Math.round(minutes % 60)).padStart(2, '0')}`;

function statusText(sim: Simulation): string {
  const stop = sim.stop;
  const where = stop ? `${stop.order ? `entrega ${stop.order} de ${sim.stops_total}: ` : ''}${stop.customer_name}` : '';
  switch (sim.phase) {
    case 'idle':
      return sim.run_id ? 'Pegando o traçado da rota…' : 'Na base, esperando o motorista tocar em “Iniciar rota” (Meus carregamentos).';
    case 'driving':
      return `Indo para a ${where}`;
    case 'at_stop':
      if (stop?.resolved) return `Descarregando em ${stop.customer_name}…`;
      return sim.auto_driver
        ? `Parado em ${stop?.customer_name}: o motorista automático confirma a entrega depois do tempo parado.`
        : `Parado em ${stop?.customer_name}: registre “Entregue” ou “Não recebeu” no app do motorista.`;
    case 'returning':
      return 'Entregas resolvidas: voltando para a base.';
    case 'at_base':
      return sim.auto_driver ? 'Na base: o motorista automático encerra a rota em instantes.' : 'Na base: encerre a rota no app do motorista.';
  }
}

const phaseTone = { idle: 'neutral', driving: 'success', at_stop: 'caution', returning: 'success', at_base: 'neutral' } as const;

function SimulationPanel({ sim: saved }: { sim: Simulation }) {
  const set = useSetSimulation();
  const skip = useSkipStop();
  const reset = useResetTest();
  // O ajuste escolhido já aparece marcado enquanto o servidor responde
  const sim: Simulation = set.isPending && set.variables ? { ...saved, ...set.variables } : saved;
  const busy = set.isPending || skip.isPending || reset.isPending;
  const change = (patch: Partial<SimulationSettings>) => set.mutate({ vehicleId: sim.vehicle_id, ...patch });
  const pct = sim.route_km ? Math.min(100, (sim.progress_km / sim.route_km) * 100) : 0;
  const routeKm = sim.route_km ?? EXAMPLE_KM;
  const estimate = clockMinutes(routeKm, sim.route_km ? sim.stops_total : 4, sim);
  const canSkip = sim.following && (sim.phase === 'driving' || sim.phase === 'returning');

  function onReset() {
    const ok = window.confirm(
      `Recomeçar o teste de hoje de ${sim.plate}?\n\n` +
        '• apaga as rotas de hoje deste veículo e as posições simuladas;\n' +
        '• devolve as entregas resolvidas hoje para o caminhão do motorista, sem os comprovantes;\n' +
        '• leva o veículo de volta para a base.',
    );
    if (ok) reset.mutate(sim.vehicle_id);
  }

  return (
    <>
      <Status aria-live="polite">
        <Head>
          <Pill $tone={sim.paused ? 'warning' : phaseTone[sim.phase]}>{sim.paused ? 'Pausado' : sim.phase_text}</Pill>
          {sim.route_km !== null && (
            <Muted style={{ fontSize: 12 }}>
              {fmtKm(sim.progress_km)} de {fmtKm(sim.route_km)} · {plural(sim.stops_done, 'entrega resolvida', 'entregas resolvidas')} de {sim.stops_total}
            </Muted>
          )}
        </Head>
        <strong>{statusText(sim)}</strong>
        {sim.route_km !== null && <Bar $pct={pct} role="progressbar" aria-valuenow={Math.round(pct)} aria-label="Andamento da rota" />}
      </Status>

      <Setting>
        <legend>Velocidade da simulação</legend>
        <Chips>
          {SPEEDS.map((s) => (
            <Chip key={s.value} type="button" $active={sim.speed_factor === s.value} aria-pressed={sim.speed_factor === s.value}
              disabled={busy} onClick={() => change({ speed_factor: s.value })}>
              {s.label}
            </Chip>
          ))}
        </Chips>
      </Setting>
      <Setting>
        <legend>Velocidade média do caminhão</legend>
        <Chips>
          {CRUISE_KMH.map((v) => (
            <Chip key={v} type="button" $active={sim.cruise_kmh === v} aria-pressed={sim.cruise_kmh === v}
              disabled={busy} onClick={() => change({ cruise_kmh: v })}>
              {v} km/h
            </Chip>
          ))}
        </Chips>
      </Setting>
      <Setting>
        <legend>Tempo parado em cada entrega</legend>
        <Chips>
          {DWELL_MIN.map((v) => (
            <Chip key={v} type="button" $active={sim.dwell_min === v} aria-pressed={sim.dwell_min === v}
              disabled={busy} onClick={() => change({ dwell_min: v })}>
              {v === 0 ? 'Sem parar' : `${v} min`}
            </Chip>
          ))}
        </Chips>
        <Muted style={{ fontSize: 12 }}>
          Com esses ajustes, {sim.route_km ? `a rota de ${fmtKm(routeKm)}` : `uma rota de ${EXAMPLE_KM} km com 4 entregas`} leva
          cerca de <strong>{fmtClock(estimate)}</strong> no relógio
          {sim.auto_driver ? '.' : ', sem contar o tempo que você leva para registrar cada entrega.'}
        </Muted>
      </Setting>

      <Check>
        <input type="checkbox" checked={sim.auto_driver} disabled={busy} onChange={(e) => change({ auto_driver: e.target.checked })} />
        <span>
          <strong>Motorista automático</strong>
          <small>
            Confirma cada entrega sozinho (com um comprovante gerado) depois do tempo parado e encerra a rota ao voltar para a
            base. Desligado, o veículo espera você registrar a entrega no app do motorista.
          </small>
        </span>
      </Check>

      <Actions>
        <Button type="button" $variant="secondary" disabled={busy} onClick={() => change({ paused: !sim.paused })}>
          <Icon name={sim.paused ? 'play' : 'pause'} size={18} />
          {sim.paused ? 'Retomar' : 'Pausar'}
        </Button>
        <Button type="button" $variant="secondary" disabled={busy || !canSkip} onClick={() => skip.mutate(sim.vehicle_id)}>
          <Icon name="navigation" size={18} />
          {sim.phase === 'returning' ? 'Pular para a base' : 'Pular para a próxima entrega'}
        </Button>
        <Button type="button" $variant="secondary" disabled={busy} onClick={onReset}>
          Recomeçar o teste
        </Button>
      </Actions>
      {reset.isSuccess && (
        <SuccessText role="status">
          Teste recomeçado: {plural(reset.data.deliveries, 'entrega voltou', 'entregas voltaram')} para o caminhão,{' '}
          {plural(reset.data.runs, 'rota apagada', 'rotas apagadas')} e {plural(reset.data.positions, 'posição simulada apagada', 'posições simuladas apagadas')}.
        </SuccessText>
      )}
      {(set.isError || skip.isError || reset.isError) && (
        <ErrorText role="alert">{errorMessage(set.error ?? skip.error ?? reset.error)}</ErrorText>
      )}
    </>
  );
}

function vehicleLabel(v: Vehicle, driverName?: string) {
  return `${v.plate}${v.model ? ` · ${v.model}` : ''} · ${driverName ?? 'sem motorista'}`;
}

/** Botão "Opções de dev" do menu e a janela com o rastreador simulado (para o gestor e o motorista). */
export function DevOptions() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [open, setOpen] = useState(false);
  const simulations = useSimulations();
  const vehicles = useVehicles(open);
  const drivers = useDrivers(open && isAdmin);
  const set = useSetSimulation();
  const stop = useStopSimulation();
  const [chosen, setChosen] = useState<number | null>(null);

  const sims = simulations.data ?? [];
  const running = sims.some((s) => !s.paused);
  const list = vehicles.data ?? [];
  const driverName = (v: Vehicle) => (isAdmin ? drivers.data?.find((d) => d.id === v.current_driver_id)?.name : user?.name);
  // Sem escolha: o veículo que já está simulando, senão o primeiro com motorista
  const vehicleId = chosen ?? sims[0]?.vehicle_id ?? list.find((v) => v.current_driver_id)?.id ?? list[0]?.id ?? null;
  const vehicle = list.find((v) => v.id === vehicleId);
  const sim = sims.find((s) => s.vehicle_id === vehicleId);
  const busy = set.isPending || stop.isPending;
  // A chave já mostra o que foi pedido enquanto o servidor responde
  const on = set.isPending ? true : stop.isPending ? false : Boolean(sim);

  return (
    <>
      <OpenButton type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="code" />
        Opções de dev
        {running && (
          <>
            <RunningDot aria-hidden="true" />
            <SrOnly>, rastreador simulado ligado</SrOnly>
          </>
        )}
        <DevTag aria-hidden="true">DEV</DevTag>
      </OpenButton>

      <Dialog open={open} title="Opções de desenvolvedor" onClose={() => setOpen(false)}>
        <Stack>
          <Muted>
            Ferramentas para testar o app sem sair com o caminhão. Aparecem só no ambiente de desenvolvimento, para o gestor e
            para o motorista.
          </Muted>

          <Section aria-labelledby="dev-sim-title">
            <Head>
              <h3 id="dev-sim-title">Rastreador simulado</h3>
              {vehicle && (
                <Switch>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={on}
                    disabled={busy}
                    onChange={(e) => (e.target.checked ? set.mutate({ vehicleId: vehicle.id }) : stop.mutate(vehicle.id))}
                  />
                  {on ? 'Ligado' : 'Desligado'}
                </Switch>
              )}
            </Head>
            <Muted>
              Faz o papel do rastreador do veículo: sai da base, segue o traçado da rota, para em cada entrega até o motorista
              registrar o que aconteceu e volta para a base. O mapa do gestor e a tela do motorista atualizam na hora.
            </Muted>

            {simulations.isError && <ErrorText role="alert">{errorMessage(simulations.error)}</ErrorText>}
            {vehicles.isSuccess && list.length === 0 && (
              <Muted>{isAdmin ? 'Cadastre um veículo para usar o simulador.' : 'Cadastre seu veículo em “Meu veículo” para usar o simulador.'}</Muted>
            )}
            {isAdmin && list.length > 0 && (
              <FieldLabel>
                Veículo
                <Select value={vehicleId ?? ''} onChange={(e) => setChosen(Number(e.target.value))}>
                  {list.map((v) => (
                    <option key={v.id} value={v.id}>
                      {vehicleLabel(v, driverName(v))}{sims.some((s) => s.vehicle_id === v.id) ? ' (simulando)' : ''}
                    </option>
                  ))}
                </Select>
              </FieldLabel>
            )}
            {!isAdmin && vehicle && <Muted>Veículo: <strong>{vehicleLabel(vehicle, user?.name)}</strong></Muted>}
            {(set.isError || stop.isError) && <ErrorText role="alert">{errorMessage(set.error ?? stop.error)}</ErrorText>}
            {sim ? <SimulationPanel sim={sim} /> : vehicle && (
              <Muted style={{ fontSize: 12 }}>
                Desligado: as posições de {vehicle.plate} vêm do rastreador de verdade (ou do GPS do celular do motorista).
              </Muted>
            )}
          </Section>

          <Section aria-labelledby="dev-howto-title">
            <h3 id="dev-howto-title">Como testar o fluxo completo</h3>
            <ol>
              <li>Ligue o rastreador simulado no veículo do motorista.</li>
              <li>No app do motorista, abra Meus carregamentos e toque em “Iniciar rota”.</li>
              <li>Acompanhe no Painel do gestor (mapa em “Caminho percorrido”) e na Rota em andamento do motorista.</li>
              <li>Em cada parada aparece “Você chegou”: registre Entregue ou Não recebeu (ou ligue o motorista automático).</li>
              <li>De volta à base, encerre a rota. Para repetir, use “Recomeçar o teste”.</li>
            </ol>
          </Section>
        </Stack>
      </Dialog>
    </>
  );
}
