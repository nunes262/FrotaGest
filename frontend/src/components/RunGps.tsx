import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { sendRunPoints } from '../api/queries';
import type { LatLng, RunPointInput } from '../api/types';

/** off: sem rota; waiting: esperando o primeiro sinal; denied: o motorista não permitiu;
 *  unavailable: navegador sem GPS ou página sem HTTPS. */
export type GpsStatus = 'off' | 'waiting' | 'active' | 'denied' | 'unavailable';

interface GpsState {
  status: GpsStatus;
  position: LatLng | null;
}

const OFF: GpsState = { status: 'off', position: null };
const GpsContext = createContext<GpsState>(OFF);

export const useGpsStatus = () => useContext(GpsContext);

// No máximo um ponto a cada 15 s, enviados juntos a cada 30 s
const SAMPLE_MS = 15_000;
const FLUSH_MS = 30_000;
const MAX_BUFFER = 500;

/** Enquanto o motorista tem uma rota em andamento, manda a posição do celular para o servidor, em qualquer tela.
 *  Ela só vale para os km quando o veículo não manda posições pelo rastreador. */
export function RunGpsProvider({ runId, children }: { runId: number | null; children: ReactNode }) {
  const [state, setState] = useState<GpsState>(OFF);

  useEffect(() => {
    if (!runId) {
      setState(OFF);
      return;
    }
    // O navegador só libera a localização em HTTPS (ou localhost)
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setState({ status: 'unavailable', position: null });
      return;
    }
    setState({ status: 'waiting', position: null });

    let buffer: RunPointInput[] = [];
    let lastSample = 0;
    const flush = () => {
      if (!buffer.length) return;
      const batch = buffer;
      buffer = [];
      // Sem conexão, os pontos voltam para a fila e vão no próximo envio
      sendRunPoints(runId, batch).catch(() => {
        buffer = [...batch, ...buffer].slice(-MAX_BUFFER);
      });
    };

    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const position: LatLng = [pos.coords.latitude, pos.coords.longitude];
        setState({ status: 'active', position });
        // Vale a hora em que a posição chegou: a do GPS pode ser de um sinal guardado de antes
        const now = Date.now();
        if (now - lastSample < SAMPLE_MS) return;
        const first = lastSample === 0;
        lastSample = now;
        buffer.push({
          latitude: position[0],
          longitude: position[1],
          accuracy_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          recorded_at: new Date(now).toISOString(),
        });
        if (first) flush(); // o primeiro ponto vai na hora, para o mapa já mostrar onde o caminhão está
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setState({ status: 'denied', position: null });
        else if (err.code === err.POSITION_UNAVAILABLE) setState((s) => ({ ...s, status: 'unavailable' }));
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    const timer = window.setInterval(flush, FLUSH_MS);
    return () => {
      navigator.geolocation.clearWatch(watch);
      window.clearInterval(timer);
      flush();
    };
  }, [runId]);

  return <GpsContext.Provider value={state}>{children}</GpsContext.Provider>;
}
