import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { submitOrQueue } from '../offline/outbox';
import type {
  ChatUser,
  Checklist,
  ChecklistAnswer,
  ChecklistItemDef,
  Expense,
  ExpenseKind,
  FuelEntry,
  CitySuggestion,
  CompanyBase,
  CostSummary,
  Conversation,
  DashboardSummary,
  Delivery,
  DeliveryCreate,
  DeliveryRun,
  Driver,
  DriverCreate,
  DriverPurge,
  DriverRemoval,
  FailureReason,
  FuelPrice,
  FuelType,
  GeocodeResult,
  LivePosition,
  Message,
  NewVehicle,
  PauseKind,
  Payment,
  PaymentOverview,
  RegionEstimate,
  RegionTable,
  RouteRegionInput,
  RouteDetail,
  RouteSummary,
  RunHistory,
  RunPointInput,
  RunSummary,
  Simulation,
  SimulationReset,
  SimulationSettings,
  StreetSuggestion,
  Tire,
  TireEvent,
  TireInput,
  TrackerCheck,
  TrackerConnection,
  Vehicle,
  VehicleDeletion,
  VehicleTrail,
  VehicleUpdate,
  VehicleUsage,
} from './types';

const LIVE_REFRESH_MS = 30_000;

export const useSummary = () =>
  useQuery({
    queryKey: ['summary'],
    queryFn: async () => (await api.get<DashboardSummary>('/tracking/summary')).data,
    refetchInterval: LIVE_REFRESH_MS,
  });

export const useLivePositions = () =>
  useQuery({
    queryKey: ['live'],
    queryFn: async () => (await api.get<LivePosition[]>('/tracking/live')).data,
    refetchInterval: LIVE_REFRESH_MS,
  });

export interface RouteFilters {
  date_from: string;
  date_to: string;
  driver_id?: number;
  vehicle_id?: number;
}

/** Caminho percorrido hoje por veículo, com a rota de entrega (modo "Caminho percorrido" do mapa). */
export const useTrails = (enabled: boolean) =>
  useQuery({
    queryKey: ['trails'],
    enabled,
    queryFn: async () => (await api.get<VehicleTrail[]>('/tracking/trails')).data,
    refetchInterval: LIVE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });

export const useRoutes = (filters: RouteFilters) =>
  useQuery({
    queryKey: ['routes', filters],
    queryFn: async () => (await api.get<RouteSummary[]>('/tracking/routes', { params: filters })).data,
  });

/** Pontos do dia e as viagens a partir da base. */
export const useRouteDetail = (vehicleId: number | undefined, day: string | undefined) =>
  useQuery({
    queryKey: ['route-detail', vehicleId, day],
    enabled: Boolean(vehicleId && day),
    queryFn: async () => (await api.get<RouteDetail>(`/tracking/routes/${vehicleId}/detail`, { params: { day } })).data,
  });

export const useCompanyBase = () =>
  useQuery({
    queryKey: ['company-base'],
    queryFn: async () => (await api.get<CompanyBase | null>('/company/base')).data,
  });

export const useSaveCompanyBase = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CompanyBase) => (await api.put<CompanyBase>('/company/base', body)).data,
    onSuccess: (base) => {
      qc.setQueryData(['company-base'], base);
      qc.invalidateQueries({ queryKey: ['live'] });
      qc.invalidateQueries({ queryKey: ['route-detail'] });
    },
  });
};

export const useTrackers = () =>
  useQuery({ queryKey: ['trackers'], queryFn: async () => (await api.get<TrackerConnection[]>('/company/trackers')).data });

/** Testa o usuário e a senha de integração no rastreador; só salva se funcionar. */
export const useConnectTracker = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ provider, user, password }: { provider: string; user: string; password: string }) =>
      (await api.put<TrackerConnection>(`/company/trackers/${provider}`, { user, password })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trackers'] }),
  });
};

export const useDisconnectTracker = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (provider: string) => {
      await api.delete(`/company/trackers/${provider}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trackers'] }),
  });
};

/** Pergunta ao rastreador se o veículo está transmitindo; as posições novas já entram no mapa. */
export const useTrackerCheck = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vehicleId: number) => (await api.post<TrackerCheck>(`/vehicles/${vehicleId}/tracker-check`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['live'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
    },
  });
};

export const useGeocode = () =>
  useMutation({
    mutationFn: async (q: string) => (await api.get<GeocodeResult[]>('/company/geocode', { params: { q } })).data,
  });

/** O gestor recebe todos os veículos; o motorista, só o que está no nome dele. */
/** Cidades (IBGE) para o texto digitado. A lista anterior continua na tela enquanto a nova chega. */
export const useCitySuggestions = (q: string) =>
  useQuery({
    queryKey: ['address', 'cities', q],
    enabled: q.length >= 2,
    staleTime: Infinity,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => (await api.get<CitySuggestion[]>('/address/cities', { params: { q }, signal })).data,
  });

/** Ruas da cidade (ViaCEP) para o texto digitado, ou o endereço de um CEP. */
export const useStreetSuggestions = (q: string, city: string, uf: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ['address', 'streets', q, city, uf],
    enabled,
    staleTime: Infinity,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      (await api.get<StreetSuggestion[]>('/address/streets', { params: { q, city, uf }, signal })).data,
  });

export const useVehicles = (enabled = true) =>
  useQuery({ queryKey: ['vehicles'], enabled, queryFn: async () => (await api.get<Vehicle[]>('/vehicles')).data });

/** O que seria apagado junto com o veículo (para a confirmação). */
export const useVehicleUsage = (vehicleId: number | null) =>
  useQuery({
    queryKey: ['vehicles', 'usage', vehicleId],
    enabled: vehicleId !== null,
    queryFn: async () => (await api.get<VehicleUsage>(`/vehicles/${vehicleId}/usage`)).data,
  });

export const useDeleteVehicle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete<VehicleDeletion>(`/vehicles/${id}`)).data,
    onSuccess: () => {
      for (const key of ['vehicles', 'live', 'tires', 'runs', 'costs', 'summary', 'routes']) qc.invalidateQueries({ queryKey: [key] });
    },
  });
};

/** O gestor cadastra qualquer veículo (já com um motorista, se quiser);
 *  o motorista sem veículo cadastra o dele, que fica no seu nome. */
export const useCreateVehicle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: NewVehicle & { current_driver_id?: number | null }) => (await api.post<Vehicle>('/vehicles', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicles'] }),
  });
};

export const useUpdateVehicle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: VehicleUpdate & { id: number }) =>
      (await api.patch<Vehicle>(`/vehicles/${id}`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['costs'] }); // combustível e consumo entram no custo por km
      qc.invalidateQueries({ queryKey: ['live'] }); // a placa aparece no mapa
    },
  });
};

export const useDrivers = (enabled = true) =>
  useQuery({ queryKey: ['drivers'], enabled, queryFn: async () => (await api.get<Driver[]>('/drivers')).data });

export const useCreateDriver = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: DriverCreate) => (await api.post<Driver>('/drivers', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
};

/** Remove o motorista: perde o acesso, o veículo fica livre e as entregas que faltavam voltam para a fila. */
export const useRemoveDriver = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete<DriverRemoval>(`/drivers/${id}`)).data,
    onSuccess: () => {
      for (const key of ['drivers', 'vehicles', 'deliveries', 'runs', 'conversations', 'contacts', 'tires']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
};

/** Exclui de vez um motorista já removido, com as rotas, GPS, comprovantes e mensagens dele. */
export const usePurgeDriver = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete<DriverPurge>(`/drivers/${id}/permanent`)).data,
    onSuccess: () => {
      for (const key of ['drivers', 'deliveries', 'runs', 'conversations', 'contacts', 'tires', 'costs', 'routes']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
};

export const useReactivateDriver = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number; vehicle_id: number | null; password: string | null }) =>
      (await api.post<Driver>(`/drivers/${id}/reactivate`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

export const useDeliveries = (day: string) =>
  useQuery({
    queryKey: ['deliveries', day],
    queryFn: async () => (await api.get<Delivery[]>('/deliveries', { params: { day } })).data,
  });

/** Entregas de um período, em ordem de dia e de parada (até 62 dias). */
export const useDeliveriesBetween = (dateFrom: string, dateTo: string) =>
  useQuery({
    queryKey: ['deliveries', 'period', dateFrom, dateTo],
    queryFn: async () =>
      (await api.get<Delivery[]>('/deliveries', { params: { date_from: dateFrom, date_to: dateTo } })).data,
  });

function useDeliveryMutation<TArg, TResult>(mutationFn: (arg: TArg) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['regions', 'estimate'] }); // o que está no caminhão muda a região prevista
    },
  });
}

export const useCreateDelivery = () =>
  useDeliveryMutation(async (body: DeliveryCreate) => (await api.post<Delivery>('/deliveries', body)).data);

/** Coloca as entregas no caminhão do motorista (na ordem enviada) ou, com driver_id nulo, devolve para a fila. */
export const useAssignDeliveries = () =>
  useDeliveryMutation(async (body: { delivery_ids: number[]; driver_id: number | null }) =>
    (await api.post<Delivery[]>('/deliveries/assign', body)).data,
  );

export const useDeleteDelivery = () =>
  useDeliveryMutation(async (id: number) => {
    await api.delete(`/deliveries/${id}`);
  });

const RUN_REFRESH_MS = 30_000;

/** Rota em andamento do motorista (atualiza os km a cada 30 s enquanto existe). */
export const useCurrentRun = (enabled = true) =>
  useQuery({
    queryKey: ['runs', 'current'],
    enabled,
    queryFn: async () => (await api.get<DeliveryRun | null>('/delivery-runs/current')).data,
    refetchInterval: (query) => (query.state.data ? RUN_REFRESH_MS : false),
  });

/** Uma rota com o mapa (traçado, paradas e por onde passou). */
export const useRun = (id: number | null) =>
  useQuery({
    queryKey: ['runs', 'detail', id],
    enabled: id !== null,
    queryFn: async () => (await api.get<DeliveryRun>(`/delivery-runs/${id}`)).data,
  });

/** Rotas feitas no período, com as entregas, as fotos e o valor (o motorista recebe só as dele). */
export const useRunHistory = (dateFrom: string, dateTo: string) =>
  useQuery({
    queryKey: ['runs', 'history', dateFrom, dateTo],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<RunHistory[]>('/delivery-runs/history', { params: { date_from: dateFrom, date_to: dateTo } })).data,
  });

/** Rotas do dia (para o gestor acompanhar quem já saiu). */
export const useRuns = (day: string, enabled = true) =>
  useQuery({
    queryKey: ['runs', 'day', day],
    enabled,
    queryFn: async () => (await api.get<RunSummary[]>('/delivery-runs', { params: { day } })).data,
    refetchInterval: 60_000,
  });

function useRunMutation<TArg>(mutationFn: (arg: TArg) => Promise<DeliveryRun>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (run) => {
      qc.setQueryData(['runs', 'current'], run.status === 'active' ? run : null);
      qc.invalidateQueries({ queryKey: ['runs', 'day'] });
      // A ordem das paradas muda e os km entram na conta dos pneus
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['tires'] });
    },
  });
}

/** Inicia a rota do dia: o servidor calcula a melhor ordem das paradas pelas ruas. */
/** Inicia a rota do dia (com o checklist de saída que o motorista acabou de fazer). */
export const useStartRun = () =>
  useRunMutation(async ({ day, checklistId }: { day: string; checklistId?: number | null }) =>
    (await api.post<DeliveryRun>('/delivery-runs', { day, checklist_id: checklistId ?? null })).data,
  );

export const useReplanRun = () =>
  useRunMutation(async (id: number) => (await api.post<DeliveryRun>(`/delivery-runs/${id}/replan`)).data);

export const useFinishRun = () =>
  useRunMutation(async (id: number) => (await api.post<DeliveryRun>(`/delivery-runs/${id}/finish`)).data);

/** Pausa para refeição, descanso ou espera de carga e descarga. */
export const useStartPause = () =>
  useRunMutation(async ({ runId, kind }: { runId: number; kind: PauseKind }) =>
    (await api.post<DeliveryRun>(`/delivery-runs/${runId}/pauses`, { kind })).data,
  );

export const useEndPause = () =>
  useRunMutation(async (runId: number) => (await api.post<DeliveryRun>(`/delivery-runs/${runId}/pauses/end`)).data);

export interface OutcomeInput {
  deliveryId: number;
  customerName: string;
  outcome: 'delivered' | 'failed';
  photo: Blob;
  /** assinatura de quem recebeu (PNG da tela) */
  signature?: Blob | null;
  receiver_name?: string;
  receiver_document?: string;
  reason?: FailureReason;
  note?: string;
  latitude?: number;
  longitude?: number;
}

const formFields = (fields: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]),
  );

/** O motorista conta, com foto, o que aconteceu no endereço. O gestor recebe o aviso na hora.
 *  Sem sinal, fica guardado no celular (e a parada já aparece resolvida) até o sinal voltar. */
export const useRegisterOutcome = () => {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always', // sem sinal, cai no armazenamento do celular em vez de ficar pausado
    mutationFn: async ({ deliveryId, customerName, photo, signature, ...fields }: OutcomeInput) => {
      const result = await submitOrQueue<Delivery>({
        url: `/deliveries/${deliveryId}/outcome`,
        label: `${fields.outcome === 'delivered' ? 'Entrega' : 'Ocorrência'} em ${customerName}`,
        fields: formFields(fields),
        files: [{ field: 'photo', blob: photo, filename: 'comprovante.jpg' }, ...(signature ? [{ field: 'signature', blob: signature, filename: 'assinatura.png' }] : [])],
      });
      if (result.queued) {
        // A parada já sai da frente do motorista; o servidor confirma quando o registro chegar
        qc.setQueryData<DeliveryRun | null>(['runs', 'current'], (run) =>
          run ? { ...run, stops: run.stops.map((s) => (s.delivery.id === deliveryId ? { ...s, delivery: { ...s.delivery, status: fields.outcome, on_board: fields.outcome === 'failed' } } : s)) } : run,
        );
      }
      return result;
    },
    onSuccess: (result) => {
      if (result.queued) return;
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['deliveries'] });
    },
  });
};

/** Imagem que precisa do token (foto, assinatura, comprovante): vem como blob e vira uma URL local. */
export const useAuthImage = (url: string | null) =>
  useQuery({
    queryKey: ['auth-image', url],
    enabled: url !== null,
    staleTime: Infinity,
    queryFn: async () => URL.createObjectURL((await api.get<Blob>(url!, { responseType: 'blob' })).data),
  });

/** Foto do comprovante (precisa do token, então vem como blob e vira uma URL local). */
export const useProofPhoto = (deliveryId: number | null) =>
  useQuery({
    queryKey: ['proof-photo', deliveryId],
    enabled: deliveryId !== null,
    staleTime: Infinity,
    queryFn: async () =>
      URL.createObjectURL((await api.get<Blob>(`/deliveries/${deliveryId}/proof/photo`, { responseType: 'blob' })).data),
  });

export const sendRunPoints = (runId: number, points: RunPointInput[]) =>
  api.post<{ accepted: number }>(`/delivery-runs/${runId}/points`, { points });

/** Pneus com o desgaste estimado: o gestor recebe os da frota; o motorista, os do veículo dele. */
export const useTires = (enabled = true) =>
  useQuery({ queryKey: ['tires'], enabled, queryFn: async () => (await api.get<Tire[]>('/tires')).data });

function useTireMutation<TArg, TResult>(mutationFn: (arg: TArg) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => qc.invalidateQueries({ queryKey: ['tires'] }) });
}

type TireMeasure = { measured_mm?: number | null };

/** A medição vai em % (measured_pct) ou em mm (measured_mm, convertida pelo sulco do pneu novo). */
export const useCreateTire = () =>
  useTireMutation(async ({ vehicleId, ...body }: Omit<TireInput, 'measured_pct'> & { measured_pct: number | null } & TireMeasure & { vehicleId: number }) =>
    (await api.post<Tire>(`/vehicles/${vehicleId}/tires`, body)).data,
  );

/** Mudar measured_pct ou measured_mm registra uma nova medição. */
export const useUpdateTire = () =>
  useTireMutation(async ({ id, ...body }: Partial<TireInput> & TireMeasure & { id: number }) =>
    (await api.patch<Tire>(`/tires/${id}`, body)).data,
  );

export const useDeleteTire = () =>
  useTireMutation(async (id: number) => {
    await api.delete(`/tires/${id}`);
  });

/** Rodízio: se a posição tem outro pneu, os dois trocam de lugar. */
export const useRotateTire = () =>
  useTireMutation(async ({ id, position }: { id: number; position: Tire['position'] }) =>
    (await api.post<Tire[]>(`/tires/${id}/rotate`, { position })).data,
  );

export const useRetreadTire = () =>
  useTireMutation(async ({ id, cost }: { id: number; cost: number | null }) =>
    (await api.post<Tire>(`/tires/${id}/retread`, { cost })).data,
  );

export const useTireEvents = (tireId: number | null) =>
  useQuery({
    queryKey: ['tires', 'events', tireId],
    enabled: tireId !== null,
    queryFn: async () => (await api.get<TireEvent[]>(`/tires/${tireId}/events`)).data,
  });

export interface CostFilters {
  date_from: string;
  date_to: string;
  fuel_type?: FuelType;
}

export const useCostSummary = (filters: CostFilters) =>
  useQuery({
    queryKey: ['costs', filters],
    queryFn: async () => (await api.get<CostSummary>('/costs/summary', { params: filters })).data,
  });

function useFuelPriceMutation<TArg>(mutationFn: (arg: TArg) => Promise<FuelPrice[]>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => qc.invalidateQueries({ queryKey: ['costs'] }) });
}

/** Troca os preços pelos da última pesquisa semanal da ANP. */
export const useRefreshFuelPrices = () =>
  useFuelPriceMutation(async (_: void) => (await api.post<FuelPrice[]>('/costs/fuel-prices/anp')).data);

export const useSetFuelPrice = () =>
  useFuelPriceMutation(async ({ fuel, price }: { fuel: FuelType; price: number }) =>
    (await api.put<FuelPrice[]>(`/costs/fuel-prices/${fuel}`, { price_per_liter: price })).data,
  );

export const useConversations = () =>
  useQuery({
    queryKey: ['conversations'],
    queryFn: async () => (await api.get<Conversation[]>('/chat/conversations')).data,
  });

export const useContacts = () =>
  useQuery({ queryKey: ['contacts'], queryFn: async () => (await api.get<ChatUser[]>('/chat/contacts')).data });

export interface ConversationInput {
  kind: Conversation['kind'];
  name?: string;
  member_ids: number[];
}

/** Para conversa individual, devolve a que já existe com a pessoa em vez de criar outra. */
export const useCreateConversation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ConversationInput) => (await api.post<Conversation>('/chat/conversations', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
};

export const useUpdateGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number; name: string; member_ids: number[] }) =>
      (await api.put<Conversation>(`/chat/conversations/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
};

export const useMarkRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: number) => {
      await api.post(`/chat/conversations/${conversationId}/read`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
};

export const useMessages = (conversationId: number | undefined) =>
  useQuery({
    queryKey: ['messages', conversationId],
    enabled: Boolean(conversationId),
    queryFn: async () => (await api.get<Message[]>(`/chat/conversations/${conversationId}/messages`)).data,
  });

export const useSendMessage = (conversationId: number | undefined) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) =>
      (await api.post<Message>(`/chat/conversations/${conversationId}/messages`, { body })).data,
    onSuccess: (msg) => {
      qc.setQueryData<Message[]>(['messages', conversationId], (old = []) =>
        old.some((m) => m.id === msg.id) ? old : [...old, msg],
      );
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
};

// ---------- pagamento dos motoristas ----------

export interface PaymentFilters {
  dateFrom: string;
  dateTo: string;
  driverId?: number | null;
}

/** Rotas do período com valor, lançamentos e saldo por motorista (o motorista recebe só o dele). */
export const usePaymentsOverview = ({ dateFrom, dateTo, driverId }: PaymentFilters) =>
  useQuery({
    queryKey: ['payments', dateFrom, dateTo, driverId ?? null],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<PaymentOverview>('/payments/overview', {
        params: { date_from: dateFrom, date_to: dateTo, driver_id: driverId || undefined },
      })).data,
  });

function usePaymentMutation<TArg, TResult>(mutationFn: (arg: TArg) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => qc.invalidateQueries({ queryKey: ['payments'] }) });
}

/** Lança o preço da região de uma rota encerrada que ficou sem valor. */
export const useLaunchRunPayment = () =>
  usePaymentMutation(async (runId: number) => (await api.post<Payment>(`/payments/runs/${runId}/launch`)).data);

export const usePayPayments = () =>
  usePaymentMutation(async ({ ids, paidOn }: { ids: number[]; paidOn?: string }) =>
    (await api.post<Payment[]>('/payments/pay', { payment_ids: ids, paid_on: paidOn || undefined })).data,
  );

export const useUnpayPayment = () =>
  usePaymentMutation(async (id: number) => (await api.post<Payment>(`/payments/${id}/unpay`)).data);

// ---------- preço da rota por região ----------

export const useRegionTable = () =>
  useQuery({ queryKey: ['regions'], queryFn: async () => (await api.get<RegionTable>('/route-regions')).data });

/** Região e preço previstos do carregamento de cada motorista no dia (antes de a rota começar). */
export const useRegionEstimates = (day: string) =>
  useQuery({
    queryKey: ['regions', 'estimate', day],
    queryFn: async () => (await api.get<RegionEstimate[]>('/route-regions/estimate', { params: { day } })).data,
  });

function useRegionMutation<TArg>(mutationFn: (arg: TArg) => Promise<RegionTable>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (table) => {
      qc.setQueryData(['regions'], table);
      qc.invalidateQueries({ queryKey: ['regions', 'estimate'] });
    },
  });
}

export const useSaveRegionTable = () =>
  useRegionMutation(async (body: { regions: RouteRegionInput[] }) =>
    (await api.put<RegionTable>('/route-regions', body)).data,
  );

export const useResetRegionTable = () =>
  useRegionMutation(async (_: void) => (await api.post<RegionTable>('/route-regions/reset')).data);

// ---------- opções de desenvolvedor ----------

/** As opções de desenvolvedor aparecem no ambiente de desenvolvimento (ou com VITE_DEV_TOOLS=true no build). */
export const DEV_TOOLS = import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === 'true';

export const useSimulations = (enabled = DEV_TOOLS) =>
  useQuery({
    queryKey: ['dev', 'simulations'],
    enabled,
    retry: false,
    queryFn: async () => (await api.get<Simulation[]>('/dev/simulations')).data,
  });

function useSimulationMutation<TArg, TResult>(mutationFn: (arg: TArg) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      for (const key of ['dev', 'live', 'trails', 'runs']) qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

/** Liga o rastreador simulado no veículo ou muda os ajustes (só os campos enviados). */
export const useSetSimulation = () =>
  useSimulationMutation(async ({ vehicleId, ...settings }: Partial<SimulationSettings> & { vehicleId: number }) =>
    (await api.put<Simulation>(`/dev/simulations/${vehicleId}`, settings)).data,
  );

export const useStopSimulation = () =>
  useSimulationMutation(async (vehicleId: number) => { await api.delete(`/dev/simulations/${vehicleId}`); });

export const useSkipStop = () =>
  useSimulationMutation(async (vehicleId: number) => (await api.post<Simulation>(`/dev/simulations/${vehicleId}/skip`)).data);

export const useResetTest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vehicleId: number) => (await api.post<SimulationReset>(`/dev/simulations/${vehicleId}/reset`)).data,
    onSuccess: () => {
      for (const key of ['dev', 'live', 'trails', 'runs', 'deliveries', 'tires', 'summary', 'routes']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
};

// ---------- checklist de saída ----------

export const useChecklistItems = () =>
  useQuery({ queryKey: ['checklist-items'], staleTime: Infinity, queryFn: async () => (await api.get<ChecklistItemDef[]>('/checklists/items')).data });

export const useChecklist = (id: number | null) =>
  useQuery({ queryKey: ['checklist', id], enabled: id !== null, queryFn: async () => (await api.get<Checklist>(`/checklists/${id}`)).data });

/** Envia o checklist (com a foto de cada item com problema); o id vai junto ao iniciar a rota. */
export const useCreateChecklist = () =>
  useMutation({
    mutationFn: async ({ answers, photos, odometer }: { answers: ChecklistAnswer[]; photos: Record<string, Blob>; odometer: string }) => {
      const form = new FormData();
      form.append('items', JSON.stringify(answers));
      if (odometer) form.append('odometer_km', odometer);
      Object.entries(photos).forEach(([key, blob]) => form.append(`photo_${key}`, blob, `${key}.jpg`));
      return (await api.post<Checklist>('/checklists', form)).data;
    },
  });

// ---------- abastecimento e despesas (funcionam sem sinal) ----------

export interface FuelInput {
  liters: string;
  total: string;
  odometer_km: string;
  fuel_type: string;
  full_tank: boolean;
  station: string;
  photo: Blob;
  latitude?: number;
  longitude?: number;
}

export const useCreateFuelEntry = () => {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ photo, ...fields }: FuelInput) =>
      submitOrQueue<FuelEntry>({
        url: '/fuel-entries',
        label: `Abastecimento de ${fields.liters} L`,
        fields: formFields(fields),
        files: [{ field: 'photo', blob: photo, filename: 'cupom.jpg' }],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuel-entries'] });
      qc.invalidateQueries({ queryKey: ['costs'] });
    },
  });
};

export const useFuelEntries = (dateFrom: string, dateTo: string) =>
  useQuery({
    queryKey: ['fuel-entries', dateFrom, dateTo],
    queryFn: async () => (await api.get<FuelEntry[]>('/fuel-entries', { params: { date_from: dateFrom, date_to: dateTo } })).data,
  });

export interface ExpenseInput {
  kind: ExpenseKind;
  amount: string;
  note: string;
  kindLabel: string;
  photo: Blob;
}

export const useCreateExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ photo, kindLabel, ...fields }: ExpenseInput) =>
      submitOrQueue<Expense>({
        url: '/expenses',
        label: `${kindLabel} de R$ ${fields.amount}`,
        fields: formFields(fields),
        files: [{ field: 'photo', blob: photo, filename: 'comprovante.jpg' }],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });
};

export const useExpenses = (dateFrom: string, dateTo: string, status?: string) =>
  useQuery({
    queryKey: ['expenses', dateFrom, dateTo, status ?? 'all'],
    queryFn: async () =>
      (await api.get<Expense[]>('/expenses', { params: { date_from: dateFrom, date_to: dateTo, status: status || undefined } })).data,
  });

export const useReviewExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, approve, reason }: { id: number; approve: boolean; reason?: string }) =>
      (await api.post<Expense>(`/expenses/${id}/review`, { approve, reason: reason || null })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
  });
};

