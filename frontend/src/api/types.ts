export type Role = 'admin' | 'driver';

export interface User {
  id: number;
  company_id: number;
  name: string;
  email: string | null;
  cpf: string | null;
  role: Role;
}

export type LiveStatus = 'moving' | 'stopped' | 'offline' | 'speeding' | 'at_base';

export interface LivePosition {
  vehicle_id: number;
  plate: string;
  driver_id: number | null;
  driver_name: string | null;
  latitude: number;
  longitude: number;
  speed_kmh: number;
  ignition: boolean;
  recorded_at: string;
  status: LiveStatus;
}

export interface RouteSummary {
  day: string;
  driver_id: number | null;
  driver_name: string | null;
  vehicle_id: number;
  plate: string;
  distance_km: number;
  driving_minutes: number;
  max_speed_kmh: number;
  speeding_events: number;
  started_at: string;
  ended_at: string;
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
  speed_kmh: number;
  recorded_at: string;
}

/** Viagem do dia: da saída da base até a volta. Os índices apontam para RouteDetail.points. */
export interface Trip {
  start_index: number;
  end_index: number;
  left_at: string;
  returned_at: string | null;
  /** false quando o dia já começou com o caminhão fora da base */
  left_base: boolean;
  distance_km: number;
}

export interface RouteDetail {
  points: RoutePoint[];
  trips: Trip[];
}

export interface CompanyBase {
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radius_m: number;
}

export interface CitySuggestion {
  name: string;
  uf: string;
}

/** Endereço do ViaCEP. `street` vem vazio no CEP geral de cidades pequenas. */
export interface StreetSuggestion {
  street: string;
  district: string;
  city: string;
  uf: string;
  cep: string;
}

export interface GeocodeResult {
  label: string;
  latitude: number;
  longitude: number;
}

export interface DashboardSummary {
  vehicles_total: number;
  vehicles_moving: number;
  km_today: number;
  deliveries_today: number;
  /** ainda aguardando carregamento */
  deliveries_pending: number;
}

export type TrackerProvider = 'mock' | 'sascar' | 'onixsat';
export type FuelType = 'diesel' | 'gasolina';
/** Rodado traseiro: simples (4 pneus, como vans) ou duplo (com pneus internos). Nulo = duplo. */
export type AxleLayout = 'single' | 'dual';

export interface NewVehicle {
  plate: string;
  model: string | null;
  capacity_kg: number | null;
  tracker_provider: TrackerProvider;
  tracker_external_id: string;
  fuel_type: FuelType | null;
  /** consumo médio, para o custo por km */
  km_per_liter: number | null;
  axle_layout: AxleLayout | null;
}

/** O que vai junto se o veículo for excluído. */
export interface VehicleUsage {
  driver_name: string | null;
  positions: number;
  runs: number;
  tires: number;
  active_run: boolean;
}

export interface VehicleDeletion {
  plate: string;
  positions: number;
  runs: number;
  tires: number;
}

export interface Vehicle extends NewVehicle {
  id: number;
  current_driver_id: number | null;
}

/** Só os campos enviados mudam. O motorista só consegue preencher o que está em branco;
 *  o motorista do veículo só o gestor troca (nulo = sem motorista). */
export type VehicleUpdate = Partial<NewVehicle> & { current_driver_id?: number | null };

export interface TrackerVehicle {
  external_id: string;
  plate: string | null;
  description: string | null;
  /** veículo do FrotaGest com esse código no rastreador */
  vehicle_id: number | null;
  vehicle_plate: string | null;
}

export interface TrackerConnection {
  provider: 'sascar';
  configured: boolean;
  user: string | null;
  vehicles: TrackerVehicle[];
}

export interface TrackerCheck {
  vehicle_id: number;
  plate: string;
  external_id: string;
  status: 'transmitting' | 'silent' | 'not_integrated';
  positions_found: number;
  stored: number;
  last: {
    recorded_at: string;
    latitude: number;
    longitude: number;
    speed_kmh: number;
    ignition: boolean;
    address: string | null;
  } | null;
}

export type CnhCategory = 'A' | 'B' | 'C' | 'D' | 'E' | 'AB' | 'AC' | 'AD' | 'AE';

export interface Driver {
  id: number;
  name: string;
  cpf: string | null;
  phone: string | null;
  cnh_number: string | null;
  cnh_category: CnhCategory | null;
  cnh_expires_at: string | null;
  active: boolean;
}

/** O que aconteceu ao remover o motorista. */
export interface DriverRemoval {
  driver: Driver;
  released_vehicles: string[];
  returned_deliveries: number;
  finished_run: boolean;
}

/** O que foi apagado ao excluir o motorista de vez. */
export interface DriverPurge {
  name: string;
  runs: number;
  gps_points: number;
  messages: number;
  proofs: number;
  deliveries_kept: number;
  payments: number;
}

export interface DriverCreate {
  name: string;
  cpf: string;
  phone: string | null;
  cnh_number: string | null;
  cnh_category: CnhCategory | null;
  cnh_expires_at: string | null;
  password: string;
  vehicle_id?: number;
  new_vehicle?: NewVehicle;
}

export type DeliveryStatus = 'pending' | 'assigned' | 'delivered' | 'failed';

export type FailureReason = 'absent' | 'refused' | 'address' | 'other';

/** Comprovante mais recente: a foto sai em /deliveries/{id}/proof/photo. */
export interface DeliveryProof {
  id: number;
  driver_id: number;
  outcome: 'delivered' | 'failed';
  reason: FailureReason | null;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  /** quem recebeu, o documento e se assinou na tela */
  receiver_name: string | null;
  receiver_document: string | null;
  has_signature: boolean;
}

export interface DeliveryCreate {
  scheduled_for: string;
  customer_name: string;
  /** telefone do cliente (só números, com DDD), para o motorista avisar pelo WhatsApp */
  customer_phone?: string | null;
  address: string;
  city: string;
  invoice_number: string | null;
  weight_kg: number;
  volumes: number | null;
}

export interface Delivery extends DeliveryCreate {
  id: number;
  status: DeliveryStatus;
  driver_id: number | null;
  stop_order: number | null;
  /** rota em que a entrega foi levada */
  run_id: number | null;
  /** ainda no caminhão: a entregar, ou não recebida enquanto a rota não volta para a base */
  on_board: boolean;
  proof: DeliveryProof | null;
}

/** Aviso que o gestor recebe quando o motorista registra o que aconteceu no endereço. */
export interface DeliveryOutcomeNotice {
  delivery_id: number;
  customer_name: string;
  driver_name: string;
  outcome: 'delivered' | 'failed';
  reason: FailureReason | null;
}

/** Aviso que o motorista recebe pelo WebSocket quando o gestor coloca entregas no caminhão dele. */
export interface DeliveriesAssigned {
  /** primeiro dia das entregas recebidas (AAAA-MM-DD) */
  day: string;
  count: number;
  weight_kg: number;
  assigned_by: string;
}

export type RunStatus = 'active' | 'finished';
export type PauseKind = 'meal' | 'rest' | 'wait';

export interface RunPause {
  id: number;
  kind: PauseKind;
  started_at: string;
  ended_at: string | null;
}

export interface RunSummary {
  id: number;
  driver_id: number;
  vehicle_id: number;
  day: string;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  planned_distance_km: number | null;
  /** km rodados até agora (ou no total, se encerrada) */
  distance_km: number;
  km_source: 'tracker' | 'phone' | null;
  active_pause: RunPause | null;
  /** peso carregado nesta rota (kg) */
  load_kg: number | null;
  /** região de preço e o preço fixo da rota (tabela por região) */
  region_name: string | null;
  region_price: number | null;
  /** checklist de saída (nulo = saiu sem checklist) */
  checklist: { id: number; issues: number } | null;
}

export interface RunStop {
  order: number;
  delivery: Delivery;
  latitude: number | null;
  longitude: number | null;
  /** 'address' pelo número, 'street' só a rua, 'city' centro da cidade; nulo = não localizada */
  precision: 'address' | 'street' | 'city' | null;
  /** do ponto anterior até esta parada */
  leg_km: number | null;
  /** false para entregas que chegaram depois do cálculo da rota */
  planned: boolean;
}

export type LatLng = [number, number];

/** Rota de entrega iniciada pelo motorista. */
export interface DeliveryRun extends RunSummary {
  plate: string;
  origin: LatLng | null;
  returns_to_base: boolean;
  return_km: number | null;
  planned_duration_min: number | null;
  /** false quando o serviço de navegação falhou e a ordem foi aproximada */
  optimized: boolean;
  geometry: LatLng[];
  stops: RunStop[];
  trail: LatLng[];
  current_position: LatLng | null;
  position_at: string | null;
  needs_replan: boolean;
  /** posição vinda do rastreador simulado (opções de desenvolvedor): o GPS do celular não vale */
  simulated: boolean;
  pauses: RunPause[];
  tire_wear_pct: number | null;
  worst_tire: Tire | null;
}

export interface RunPointInput {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  recorded_at: string;
}

export type TirePosition =
  | 'E1E' | 'E1D' | 'E2E' | 'E2D' | 'E2EE' | 'E2EI' | 'E2DI' | 'E2DE' | 'E3EE' | 'E3EI' | 'E3DI' | 'E3DE' | 'ESTEPE';

export interface TireInput {
  position: TirePosition;
  brand: string | null;
  identification: string | null;
  /** quanto da banda restava na medição, em % */
  measured_pct: number;
  /** sulco do pneu novo, em mm (com ele dá para medir em mm) */
  tread_new_mm: number | null;
  /** km de 100% até 0% da banda */
  life_km: number;
  /** preço pago, em R$ */
  cost: number | null;
}

export interface Tire extends TireInput {
  id: number;
  vehicle_id: number;
  measured_at: string;
  /** o estepe não gasta */
  in_use: boolean;
  km_since_measure: number;
  wear_since_measure_pct: number;
  estimated_pct: number;
  /** desgaste estimado = 100% − banda restante */
  wear_pct: number;
  wear_per_1000km_pct: number;
  remaining_km: number;
  retreads: number;
  km_on_tire: number;
  cost_per_km: number | null;
  /** sulco estimado hoje, em mm */
  estimated_mm: number | null;
  /** km até o desgaste chegar a 50% (rodízio) e passar de 75% (trocar) */
  km_to_rotation: number | null;
  km_to_replacement: number;
}

export interface TireEvent {
  id: number;
  kind: 'mount' | 'measure' | 'rotation' | 'retread';
  happened_at: string;
  vehicle_km: number;
  measured_pct: number | null;
  cost: number | null;
  detail: string | null;
}

export interface FuelPrice {
  fuel_type: FuelType;
  price_per_liter: number | null;
  source: 'anp' | 'manual' | null;
  reference: string | null;
  updated_at: string | null;
}

export interface VehicleCost {
  vehicle_id: number;
  plate: string;
  model: string | null;
  drivers: string[];
  fuel_type: FuelType | null;
  km_per_liter: number | null;
  distance_km: number;
  liters: number | null;
  fuel_cost: number | null;
  tire_cost: number;
  total_cost: number | null;
  cost_per_km: number | null;
  /** o que falta para o custo ficar completo */
  missing: ('fuel_type' | 'km_per_liter' | 'price')[];
  /** abastecimentos registrados no período: gasto real e o consumo que eles indicam */
  refuel_liters: number;
  refuel_spent: number;
  refuel_count: number;
  real_km_per_liter: number | null;
  consumption_alert: boolean;
}

export interface CostSummary {
  date_from: string;
  date_to: string;
  fuel_type: FuelType | null;
  prices: FuelPrice[];
  vehicles: VehicleCost[];
  distance_km: number;
  fuel_cost: number;
  tire_cost: number;
  total_cost: number;
  cost_per_km: number | null;
  refuel_spent: number;
  refuel_liters: number;
}

export interface ChatUser {
  id: number;
  name: string;
  role: Role;
}

export interface Conversation {
  id: number;
  kind: 'group' | 'direct';
  name: string;
  members: ChatUser[];
  last_message: string | null;
  last_message_at: string | null;
  last_message_sender_id: number | null;
  last_message_sender_name: string | null;
  unread_count: number;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_name: string | null;
  body: string;
  created_at: string;
}

/** Caminho percorrido no dia por um veículo e a rota de entrega dele (mapa do gestor). */
export interface TrailStop {
  order: number;
  delivery_id: number;
  customer_name: string;
  latitude: number;
  longitude: number;
  status: DeliveryStatus;
}

export interface VehicleTrail {
  vehicle_id: number;
  plate: string;
  driver_id: number | null;
  driver_name: string | null;
  points: LatLng[];
  distance_km: number;
  run: { id: number; status: RunStatus; geometry: LatLng[]; stops: TrailStop[] } | null;
}

/** Rastreador simulado (opções de desenvolvedor). */
export type SimPhase = 'idle' | 'driving' | 'at_stop' | 'returning' | 'at_base';

export interface SimulationSettings {
  /** vezes mais rápido que o tempo real */
  speed_factor: number;
  cruise_kmh: number;
  /** minutos (do tempo simulado) parado em cada entrega */
  dwell_min: number;
  auto_driver: boolean;
  paused: boolean;
}

export interface Simulation extends SimulationSettings {
  vehicle_id: number;
  plate: string;
  driver_name: string | null;
  phase: SimPhase;
  phase_text: string;
  run_id: number | null;
  following: boolean;
  progress_km: number;
  route_km: number | null;
  stops_total: number;
  stops_done: number;
  stop: { delivery_id: number; customer_name: string; order: number | null; resolved: boolean } | null;
  latitude: number | null;
  longitude: number | null;
}

export interface SimulationReset {
  runs: number;
  deliveries: number;
  positions: number;
}

/** Pagamento dos motoristas: rotas com valor (sozinhas ou em conjunto), a pagar e pagas. */
export type PaymentStatus = 'pending' | 'paid';

export interface PaymentRun {
  id: number;
  day: string;
  driver_id: number;
  driver_name: string | null;
  plate: string | null;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  distance_km: number;
  deliveries: number;
  delivered: number;
  failed: number;
  /** peso carregado na rota e o que foi entregue (kg) */
  load_kg: number;
  delivered_kg: number;
  region_name: string | null;
  region_price: number | null;
  payment_id: number | null;
}

export interface Payment {
  id: number;
  driver_id: number;
  driver_name: string | null;
  amount: number;
  description: string | null;
  status: PaymentStatus;
  paid_on: string | null;
  created_at: string;
  runs: PaymentRun[];
}

export interface DriverBalance {
  driver_id: number;
  driver_name: string | null;
  active: boolean;
  /** a pagar, de qualquer data */
  pending_amount: number;
  pending_count: number;
  /** pago no período */
  paid_amount: number;
  paid_count: number;
  /** rotas encerradas no período ainda sem valor */
  unpriced_runs: number;
}

export interface PaymentOverview {
  balances: DriverBalance[];
  runs: PaymentRun[];
  payments: Payment[];
}

export interface PaymentsChanged {
  kind: 'created' | 'updated' | 'paid' | 'unpaid' | 'deleted';
  amount: number;
  count: number;
}

/** Preço fixo da rota por região: vale a região que lista a cidade da entrega ou, se nenhuma, a faixa de distância da base. */
export interface RouteRegionInput {
  name: string;
  price: number;
  /** distância em linha reta da base (km); nulo = sem limite */
  max_km: number | null;
  cities: string[];
}

export interface RouteRegion extends RouteRegionInput {
  id: number;
}

export interface RegionTable {
  regions: RouteRegion[];
  has_base: boolean;
}

export interface RegionEstimate {
  driver_id: number;
  region_name: string | null;
  price: number | null;
  unplaced: number;
}

/** Rota feita: as entregas que levou (com os comprovantes), o valor e se já foi pago. */
export interface RunHistory extends RunSummary {
  /** Rota 1, 2… do motorista naquele dia */
  day_index: number;
  driver_name: string | null;
  plate: string;
  stops: Delivery[];
  payment: { amount: number; status: PaymentStatus; paid_on: string | null } | null;
  expenses: ExpenseBrief[];
}

/** Checklist antes de sair. */
export interface ChecklistItemDef {
  key: string;
  label: string;
}

export interface ChecklistAnswer {
  key: string;
  ok: boolean;
  note: string | null;
}

export interface Checklist {
  id: number;
  issues: number;
  driver_id: number;
  driver_name: string | null;
  vehicle_id: number;
  plate: string | null;
  run_id: number | null;
  odometer_km: number | null;
  created_at: string;
  items: (ChecklistAnswer & { label: string; has_photo: boolean })[];
}

/** Abastecimento registrado pelo motorista. */
export interface FuelEntry {
  id: number;
  vehicle_id: number;
  plate: string | null;
  driver_id: number;
  driver_name: string | null;
  run_id: number | null;
  filled_at: string;
  liters: number;
  total: number;
  price_per_liter: number;
  odometer_km: number | null;
  fuel_type: FuelType;
  full_tank: boolean;
  station: string | null;
}

/** Despesa da rota, reembolsada depois de aprovada. */
export type ExpenseKind = 'toll' | 'parking' | 'unloading' | 'meal' | 'other';
export type ExpenseStatus = 'pending' | 'approved' | 'rejected';

export interface ExpenseBrief {
  id: number;
  kind: ExpenseKind;
  kind_label: string;
  amount: number;
  status: ExpenseStatus;
}

export interface Expense extends ExpenseBrief {
  driver_id: number;
  driver_name: string | null;
  run_id: number | null;
  run_day: string | null;
  note: string | null;
  reject_reason: string | null;
  spent_at: string;
  reviewed_at: string | null;
  payment_status: PaymentStatus | null;
}
