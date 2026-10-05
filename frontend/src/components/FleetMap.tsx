import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { Fragment, useEffect, useRef } from 'react';
import L, { type LatLngExpression } from 'leaflet';
import styled, { css, useTheme } from 'styled-components';
import type { CompanyBase, LatLng, LivePosition, LiveStatus, RoutePoint, TrailStop, VehicleTrail } from '../api/types';

/** Paradas numeradas na cor da situação (rota do motorista e caminho percorrido no painel). */
export const stopIconCss = css`
  .fg-stop-icon {
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    background: ${({ theme }) => theme.color.textStrong};
    color: ${({ theme }) => theme.color.textInvert};
    font-size: ${({ theme }) => theme.font.size.sm};
    font-weight: ${({ theme }) => theme.font.weight.bold};
  }
  .fg-stop-icon.fg-next { background: ${({ theme }) => theme.color.primary}; }
  .fg-stop-icon.fg-delivered { background: ${({ theme }) => theme.color.success}; }
  .fg-stop-icon.fg-failed { background: ${({ theme }) => theme.color.danger}; }
`;

export type StopState = 'next' | 'delivered' | 'failed' | 'todo';
const stopIcons = new Map<string, L.DivIcon>();

export function stopIcon(n: number, state: StopState): L.DivIcon {
  const key = `${n}-${state}`;
  if (!stopIcons.has(key)) {
    stopIcons.set(key, L.divIcon({ className: `fg-stop-icon fg-${state}`, html: String(n), iconSize: [28, 28], iconAnchor: [14, 14] }));
  }
  return stopIcons.get(key)!;
}

/** Cores dos caminhos percorridos, uma por veículo (o vermelho fica para a base e as paradas). */
export const TRAIL_COLORS = ['#1a73e8', '#e37400', '#9334e6', '#00838f', '#c2185b', '#5d4037'];

const Frame = styled.div<{ $picking: boolean }>`
  height: 420px;
  border-radius: ${({ theme }) => theme.radius};
  overflow: hidden;
  .leaflet-container { height: 100%; font-family: inherit; cursor: ${({ $picking }) => ($picking ? 'crosshair' : 'grab')}; }

  .fg-vehicle-icon span {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 1px 5px rgba(0, 0, 0, 0.4);
    color: #fff;
    display: grid;
    place-items: center;
    transition: transform 150ms ease;
  }
  .fg-vehicle-icon span.fg-selected {
    transform: scale(1.25);
    box-shadow: 0 0 0 3px ${({ theme }) => theme.color.primary}, 0 1px 5px rgba(0, 0, 0, 0.4);
  }
  .fg-base-icon {
    display: grid;
    place-items: center;
    border-radius: ${({ theme }) => theme.radius};
    background: ${({ theme }) => theme.color.primary};
    color: ${({ theme }) => theme.color.textInvert};
    border: 2px solid #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  }
  ${stopIconCss}
`;

const CONTAGEM: LatLngExpression = [-19.932, -44.054];

export const baseIcon = L.divIcon({
  className: 'fg-base-icon',
  html:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10l9-6 9 6v10H3z M9 20v-6h6v6"/></svg>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const TRUCK_PATH = 'M3 7h11v9H3z M14 10h4l3 3v3h-7z M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z';
const vehicleIcons = new Map<string, L.DivIcon>();

/** Ícone do veículo na cor do status (guardado para o Leaflet não recriar a cada atualização). */
export function vehicleIcon(color: string, selected: boolean): L.DivIcon {
  const key = `${color}-${selected}`;
  if (!vehicleIcons.has(key)) {
    vehicleIcons.set(key, L.divIcon({
      className: 'fg-vehicle-icon',
      html:
        `<span class="${selected ? 'fg-selected' : ''}" style="background:${color}">` +
        `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${TRUCK_PATH}"/></svg></span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    }));
  }
  return vehicleIcons.get(key)!;
}

/** Enquadra os pontos. Só reenquadra quando eles mudam (ou quando muda o fitKey, se informado: assim as posições
 *  que chegam a cada poucos segundos não tiram o zoom de quem está olhando o mapa). */
export function FitBounds({ coords, fitKey }: { coords: [number, number][]; fitKey?: string }) {
  const map = useMap();
  const latest = useRef(coords);
  latest.current = coords;
  const key = fitKey ?? JSON.stringify(coords);
  useEffect(() => {
    const list = latest.current;
    // Sem animação: sair da tela no meio de uma animação do Leaflet gera erro
    if (list.length === 1) map.setView(list[0], 15, { animate: false });
    else if (list.length > 1) map.fitBounds(list, { padding: [32, 32], maxZoom: 15, animate: false });
  }, [map, key]);
  return null;
}

/** Mantém o veículo à vista: só move o mapa quando ele se aproxima da borda, sem mexer no zoom. */
export function Follow({ position }: { position: LatLng | null }) {
  const map = useMap();
  const [lat, lon] = position ?? [];
  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    if (!map.getBounds().pad(-0.15).contains([lat, lon])) map.panTo([lat, lon], { animate: false });
  }, [map, lat, lon]);
  return null;
}

/** Situação de cada parada: feitas em verde/vermelho, a próxima em destaque. */
export function stopStates(stops: TrailStop[]): StopState[] {
  const next = stops.find((s) => s.status !== 'delivered' && s.status !== 'failed');
  return stops.map((s) =>
    s.status === 'delivered' || s.status === 'failed' ? s.status : s.delivery_id === next?.delivery_id ? 'next' : 'todo',
  );
}

function ClickToPick({ onPick }: { onPick: (latitude: number, longitude: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export const statusLabel: Record<LiveStatus, string> = {
  moving: 'Em rota',
  stopped: 'Parado',
  offline: 'Sem sinal',
  speeding: 'Acima da velocidade',
  at_base: 'Na base',
};

const coordsOf = (points: { latitude: number; longitude: number }[]) =>
  points.map((p) => [p.latitude, p.longitude] as [number, number]);

interface Props {
  vehicles?: LivePosition[];
  route?: RoutePoint[];
  /** Trecho em destaque (uma viagem); o resto da rota fica apagado */
  highlight?: RoutePoint[];
  base?: CompanyBase | null;
  /** Ativa a escolha de um ponto com clique (tela de configurações) */
  onPick?: (latitude: number, longitude: number) => void;
  /** Onde centralizar, quando quem usa o mapa quer decidir (ex.: não reenquadrar a cada clique) */
  fitTo?: [number, number] | null;
  /** Veículo em destaque no mapa e o clique no ícone de um veículo */
  selectedVehicleId?: number | null;
  onSelectVehicle?: (vehicleId: number) => void;
  /** Caminho percorrido por veículo, com a rota planejada e as paradas (modo "Caminho percorrido") */
  trails?: VehicleTrail[];
  /** Pontos para enquadrar e quando reenquadrar (ver FitBounds) */
  fit?: LatLng[];
  fitKey?: string;
  /** Posição para manter à vista (veículo selecionado) */
  follow?: LatLng | null;
}

export const trailColor = (vehicleId: number, trails: VehicleTrail[]) =>
  TRAIL_COLORS[Math.max(0, trails.findIndex((t) => t.vehicle_id === vehicleId)) % TRAIL_COLORS.length];

export function FleetMap({
  vehicles = [], route = [], highlight = [], base, onPick, fitTo, selectedVehicleId, onSelectVehicle, trails = [], fit: fitPoints,
  fitKey, follow = null,
}: Props) {
  const theme = useTheme();
  const statusColor: Record<LiveStatus, string> = {
    moving: theme.color.success,
    stopped: '#7a7a7a',
    offline: theme.color.disabled,
    speeding: theme.color.warning,
    at_base: theme.color.textStrong,
  };

  const routeCoords = coordsOf(route);
  const highlightCoords = coordsOf(highlight);
  const focus = highlight.length ? highlightCoords : route.length ? routeCoords : coordsOf(vehicles);
  const baseCoord: [number, number] | null = base ? [base.latitude, base.longitude] : null;
  const fit = fitPoints ?? (fitTo !== undefined ? (fitTo ? [fitTo] : []) : baseCoord ? [...focus, baseCoord] : focus);
  const last = highlight[highlight.length - 1];

  return (
    <Frame $picking={Boolean(onPick)}>
      <MapContainer center={baseCoord ?? CONTAGEM} zoom={11} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds coords={fit} fitKey={fitKey} />
        <Follow position={follow} />
        {onPick && <ClickToPick onPick={onPick} />}
        {base && baseCoord && (
          <>
            <Circle
              center={baseCoord}
              radius={base.radius_m}
              pathOptions={{ color: theme.color.primary, weight: 1.5, dashArray: '4 4', fillColor: theme.color.primary, fillOpacity: 0.08 }}
            />
            <Marker position={baseCoord} icon={baseIcon} title={base.name} keyboard={false} interactive={!onPick}>
              <Tooltip direction="top" offset={[0, -16]}>{base.name}</Tooltip>
            </Marker>
          </>
        )}
        {route.length > 1 && (
          <Polyline
            positions={routeCoords}
            pathOptions={
              highlight.length
                ? { color: '#9a9a9a', weight: 3, dashArray: '6 6', opacity: 0.7 }
                : { color: theme.color.primary, weight: 4, dashArray: '10 6' }
            }
          />
        )}
        {highlight.length > 1 && <Polyline positions={highlightCoords} pathOptions={{ color: theme.color.primary, weight: 5 }} />}
        {last && (
          <CircleMarker center={[last.latitude, last.longitude]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: theme.color.primary, fillOpacity: 1 }} />
        )}
        {trails.map((t) => {
          const color = trailColor(t.vehicle_id, trails);
          const states = t.run ? stopStates(t.run.stops) : [];
          return (
            <Fragment key={t.vehicle_id}>
              {t.run && t.run.status === 'active' && t.run.geometry.length > 1 && (
                <Polyline positions={t.run.geometry} pathOptions={{ color, weight: 3, opacity: 0.45, dashArray: '8 8' }} />
              )}
              {t.points.length > 1 && (
                <Polyline positions={t.points} pathOptions={{ color, weight: 5, opacity: 0.9 }}>
                  <Tooltip sticky>{t.plate} · {t.driver_name ?? 'sem motorista'} · caminho percorrido hoje</Tooltip>
                </Polyline>
              )}
              {t.run?.stops.map((s, i) => (
                <Marker
                  key={s.delivery_id}
                  position={[s.latitude, s.longitude]}
                  icon={stopIcon(s.order, states[i])}
                  title={`${s.order}. ${s.customer_name}`}
                  keyboard={false}
                >
                  <Tooltip direction="top" offset={[0, -14]}>{s.order}. {s.customer_name} · {t.driver_name ?? t.plate}</Tooltip>
                </Marker>
              ))}
            </Fragment>
          );
        })}
        {vehicles.map((v) => (
          <Marker
            key={v.vehicle_id}
            position={[v.latitude, v.longitude]}
            icon={vehicleIcon(statusColor[v.status], v.vehicle_id === selectedVehicleId)}
            title={`${v.plate} · ${statusLabel[v.status]}`}
            zIndexOffset={v.vehicle_id === selectedVehicleId ? 1000 : 0}
            eventHandlers={{ click: () => onSelectVehicle?.(v.vehicle_id) }}
          >
            <Tooltip direction="top" offset={[0, -18]} permanent>
              {v.plate} · {v.driver_name ?? 'sem motorista'}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </Frame>
  );
}
