import { MapContainer, Marker, Polyline, TileLayer, Tooltip } from 'react-leaflet';
import styled, { useTheme } from 'styled-components';
import type { CompanyBase, LatLng, RunStop } from '../api/types';
import { baseIcon, FitBounds, Follow, stopIcon, stopIconCss, vehicleIcon, type StopState } from './FleetMap';

const Frame = styled.div`
  height: 480px;
  border-radius: ${({ theme }) => theme.radius};
  overflow: hidden;
  @media (max-width: 720px) { height: 380px; }

  .leaflet-container { height: 100%; font-family: inherit; }
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
  .fg-vehicle-icon span {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 1px 5px rgba(0, 0, 0, 0.4);
    color: #fff;
    display: grid;
    place-items: center;
  }
`;

const stateOf = (s: RunStop, nextId: number | undefined): StopState =>
  s.delivery.status === 'delivered' || s.delivery.status === 'failed'
    ? s.delivery.status
    : s.delivery.id === nextId ? 'next' : 'todo';

interface Props {
  base: CompanyBase | null | undefined;
  stops: RunStop[];
  /** Traçado planejado pelas ruas */
  geometry: LatLng[];
  /** Caminho já percorrido */
  trail: LatLng[];
  position: LatLng | null;
}

/** Mapa da rota em andamento: paradas na ordem calculada, o traçado planejado e por onde o caminhão já passou. */
export function RunMap({ base, stops, geometry, trail, position }: Props) {
  const theme = useTheme();
  const located = stops.filter((s) => s.latitude !== null && s.longitude !== null);
  const next = stops.find((s) => s.delivery.status !== 'delivered' && s.delivery.status !== 'failed');
  const baseCoord: LatLng | null = base ? [base.latitude, base.longitude] : null;
  const fit: LatLng[] = [
    ...located.map((s) => [s.latitude!, s.longitude!] as LatLng),
    ...(baseCoord ? [baseCoord] : []),
    ...(position ? [position] : []),
  ];
  // Reenquadra quando as paradas mudam (rota recalculada), não a cada posição nova do caminhão
  const fitKey = JSON.stringify([located.map((s) => s.delivery.id), baseCoord, Boolean(position)]);

  return (
    <Frame>
      <MapContainer center={baseCoord ?? fit[0] ?? [-19.932, -44.054]} zoom={10} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds coords={fit} fitKey={fitKey} />
        <Follow position={position} />
        {geometry.length > 1 && (
          <Polyline positions={geometry} pathOptions={{ color: theme.color.primary, weight: 5, opacity: 0.7 }} />
        )}
        {trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: theme.color.textStrong, weight: 4, dashArray: '6 6' }} />}
        {base && baseCoord && (
          <Marker position={baseCoord} icon={baseIcon} title={base.name} keyboard={false}>
            <Tooltip direction="top" offset={[0, -16]}>{base.name}</Tooltip>
          </Marker>
        )}
        {located.map((s) => (
          <Marker
            key={s.delivery.id}
            position={[s.latitude!, s.longitude!]}
            icon={stopIcon(s.order, stateOf(s, next?.delivery.id))}
            title={`${s.order}. ${s.delivery.customer_name}`}
          >
            <Tooltip direction="top" offset={[0, -14]}>
              {s.order}. {s.delivery.customer_name} · {s.delivery.city}
            </Tooltip>
          </Marker>
        ))}
        {position && (
          // Por cima das paradas: parado numa entrega, o caminhão continua à vista
          <Marker position={position} icon={vehicleIcon(theme.color.success, false)} zIndexOffset={1000} keyboard={false}>
            <Tooltip direction="top" offset={[0, -18]}>Você está aqui</Tooltip>
          </Marker>
        )}
      </MapContainer>
    </Frame>
  );
}
