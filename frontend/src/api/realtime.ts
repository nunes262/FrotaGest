import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { chatSocketUrl } from './client';
import type { DeliveriesAssigned, DeliveryOutcomeNotice, Message, PaymentsChanged } from './types';

const RECONNECT_MS = 3_000;
const PING_MS = 25_000;

type RealtimeEvent =
  | { type: 'message'; data: Message }
  | { type: 'conversation' }
  | { type: 'deliveries_assigned'; data: DeliveriesAssigned }
  | { type: 'deliveries_changed' }
  | { type: 'run_changed' }
  | { type: 'delivery_outcome'; data: DeliveryOutcomeNotice }
  | { type: 'positions'; vehicle_id: number }
  | { type: 'simulation'; vehicle_id: number }
  | { type: 'payments_changed'; data: PaymentsChanged | null }
  | { type: 'expense_submitted'; data: ExpenseNotice }
  | { type: 'expense_reviewed'; data: ExpenseNotice & { approved: boolean; reason: string | null } }
  | { type: 'checklist_issues'; data: ChecklistIssues };

export interface ExpenseNotice {
  id: number;
  amount: number;
  kind_label: string;
  driver_name?: string;
}

export interface ChecklistIssues {
  run_id: number;
  checklist_id: number;
  issues: number;
  driver_name: string;
  plate: string;
}

interface Handlers {
  /** O gestor acabou de colocar entregas no caminhão deste motorista. */
  onDeliveriesAssigned?: (notice: DeliveriesAssigned) => void;
  /** Um motorista registrou entrega feita ou não recebida (para o gestor). */
  onDeliveryOutcome?: (notice: DeliveryOutcomeNotice) => void;
  /** A base lançou um valor ou registrou um pagamento (para o motorista). */
  onPaymentsChanged?: (notice: PaymentsChanged) => void;
  /** Despesa para aprovar (gestor) ou analisada (motorista). */
  onExpenseSubmitted?: (notice: ExpenseNotice) => void;
  onExpenseReviewed?: (notice: ExpenseNotice & { approved: boolean; reason: string | null }) => void;
  /** Motorista saiu com pendência no checklist (gestor). */
  onChecklistIssues?: (notice: ChecklistIssues) => void;
}

/** Mantém o WebSocket aberto enquanto o usuário está logado, em qualquer tela, para as mensagens novas,
 *  o contador de não lidas e os carregamentos do motorista chegarem na hora. Reconecta sozinho se cair. */
export function useRealtime(enabled: boolean, handlers: Handlers = {}) {
  const qc = useQueryClient();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket;
    let retry: number | undefined;
    let stopped = false;
    let reconnecting = false;

    const connect = () => {
      ws = new WebSocket(chatSocketUrl());
      ws.onopen = () => {
        // O que chegou enquanto a conexão estava caída não vem pelo socket: busca de novo
        if (reconnecting) {
          qc.invalidateQueries({ queryKey: ['conversations'] });
          qc.invalidateQueries({ queryKey: ['deliveries'] });
          qc.invalidateQueries({ queryKey: ['runs'] });
          qc.invalidateQueries({ queryKey: ['payments'] });
        }
      };
      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data) as RealtimeEvent;
        switch (payload.type) {
          case 'message': {
            const msg = payload.data;
            qc.setQueryData<Message[]>(['messages', msg.conversation_id], (old) =>
              old && !old.some((m) => m.id === msg.id) ? [...old, msg] : old,
            );
            qc.invalidateQueries({ queryKey: ['conversations'] });
            break;
          }
          case 'conversation':
            // Grupo criado ou alterado: atualiza a lista e as não lidas
            qc.invalidateQueries({ queryKey: ['conversations'] });
            break;
          case 'deliveries_assigned':
            qc.invalidateQueries({ queryKey: ['deliveries'] });
            qc.invalidateQueries({ queryKey: ['regions', 'estimate'] });
            qc.invalidateQueries({ queryKey: ['runs'] }); // a rota em andamento pode precisar ser recalculada
            handlersRef.current.onDeliveriesAssigned?.(payload.data);
            break;
          case 'deliveries_changed':
            qc.invalidateQueries({ queryKey: ['deliveries'] });
            qc.invalidateQueries({ queryKey: ['regions', 'estimate'] });
            qc.invalidateQueries({ queryKey: ['runs'] });
            break;
          case 'delivery_outcome':
            qc.invalidateQueries({ queryKey: ['deliveries'] });
            qc.invalidateQueries({ queryKey: ['runs'] });
            qc.invalidateQueries({ queryKey: ['payments'] }); // entregas feitas por rota
            handlersRef.current.onDeliveryOutcome?.(payload.data);
            break;
          case 'run_changed':
            // Um motorista iniciou, recalculou ou encerrou a rota (tela de carregamento do gestor)
            qc.invalidateQueries({ queryKey: ['runs'] });
            qc.invalidateQueries({ queryKey: ['deliveries'] });
            qc.invalidateQueries({ queryKey: ['tires'] });
            qc.invalidateQueries({ queryKey: ['trails'] });
            qc.invalidateQueries({ queryKey: ['dev'] });
            qc.invalidateQueries({ queryKey: ['payments'] }); // rota nova ou encerrada para dar valor
            break;
          case 'positions':
            // O rastreador simulado andou: mapa ao vivo, caminho percorrido, km da rota e desgaste dos pneus
            for (const key of ['live', 'trails', 'runs', 'dev']) qc.invalidateQueries({ queryKey: [key] });
            break;
          case 'expense_submitted':
            qc.invalidateQueries({ queryKey: ['expenses'] });
            handlersRef.current.onExpenseSubmitted?.(payload.data);
            break;
          case 'expense_reviewed':
            for (const key of ['expenses', 'payments', 'runs']) qc.invalidateQueries({ queryKey: [key] });
            handlersRef.current.onExpenseReviewed?.(payload.data);
            break;
          case 'checklist_issues':
            qc.invalidateQueries({ queryKey: ['runs'] });
            handlersRef.current.onChecklistIssues?.(payload.data);
            break;
          case 'payments_changed':
            qc.invalidateQueries({ queryKey: ['payments'] });
            if (payload.data) handlersRef.current.onPaymentsChanged?.(payload.data);
            break;
          case 'simulation':
            // Ligou, desligou ou mudou de fase (chegou numa entrega, voltou para a base)
            for (const key of ['dev', 'runs', 'summary']) qc.invalidateQueries({ queryKey: [key] });
            break;
        }
      };
      ws.onclose = (event) => {
        // 4401: sessão inválida ou usuário removido. Não adianta reconectar; a próxima chamada leva ao login.
        if (stopped || event.code === 4401) return;
        reconnecting = true;
        retry = window.setTimeout(connect, RECONNECT_MS);
      };
    };

    connect();
    const ping = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS);
    return () => {
      stopped = true;
      window.clearInterval(ping);
      window.clearTimeout(retry);
      ws.close();
    };
  }, [enabled, qc]);
}
