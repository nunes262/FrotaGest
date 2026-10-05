import type { AxleLayout, FuelType, NewVehicle, TrackerProvider, Vehicle } from '../api/types';
import { FieldLabel, Input, Select } from './ui';

const TRACKERS: { value: TrackerProvider; label: string }[] = [
  { value: 'sascar', label: 'Sascar' },
  { value: 'onixsat', label: 'Onixsat' },
  { value: 'mock', label: 'Simulador (testes)' },
];

export const FUEL_LABEL: Record<FuelType, string> = { diesel: 'Diesel S10', gasolina: 'Gasolina' };

export interface VehicleFormState {
  plate: string;
  model: string;
  capacity_kg: string;
  tracker_provider: TrackerProvider;
  tracker_external_id: string;
  fuel_type: FuelType | '';
  km_per_liter: string;
  axle_layout: AxleLayout;
}

export const AXLE_LABEL: Record<AxleLayout, string> = {
  dual: 'Duplo (com pneus internos)',
  single: 'Simples (4 pneus, como vans)',
};

export type VehicleField = keyof VehicleFormState;

export const emptyVehicleForm: VehicleFormState = {
  plate: '',
  model: '',
  capacity_kg: '',
  tracker_provider: 'sascar',
  tracker_external_id: '',
  fuel_type: '',
  km_per_liter: '',
  axle_layout: 'dual',
};

export const vehicleFieldLabel: Record<VehicleField, string> = {
  plate: 'placa',
  model: 'modelo',
  capacity_kg: 'capacidade de carga',
  tracker_provider: 'rastreador',
  tracker_external_id: 'código no rastreador',
  fuel_type: 'combustível',
  km_per_liter: 'consumo (km/l)',
  axle_layout: 'rodado traseiro',
};

/** Campos que a base deixou em branco no veículo (o rodado vazio vale como duplo, não conta). */
export const blankVehicleFields = (v: Vehicle): VehicleField[] =>
  (Object.keys(vehicleFieldLabel) as VehicleField[]).filter((f) => f !== 'axle_layout' && (v[f] === null || v[f] === ''));

export const vehicleToForm = (v: Vehicle): VehicleFormState => ({
  plate: v.plate,
  model: v.model ?? '',
  capacity_kg: v.capacity_kg ? String(v.capacity_kg) : '',
  tracker_provider: v.tracker_provider,
  tracker_external_id: v.tracker_external_id,
  fuel_type: v.fuel_type ?? '',
  km_per_liter: v.km_per_liter ? String(v.km_per_liter) : '',
  axle_layout: v.axle_layout ?? 'dual',
});

export const formToVehicle = (f: VehicleFormState): NewVehicle => ({
  plate: f.plate,
  model: f.model.trim() || null,
  capacity_kg: f.capacity_kg ? Number(f.capacity_kg) : null,
  tracker_provider: f.tracker_provider,
  tracker_external_id: f.tracker_external_id.trim(),
  fuel_type: f.fuel_type || null,
  km_per_liter: f.km_per_liter ? Number(f.km_per_liter) : null,
  axle_layout: f.axle_layout,
});

interface Props {
  value: VehicleFormState;
  onChange: (patch: Partial<VehicleFormState>) => void;
  /** Campos mostrados só para leitura (já cadastrados pela base). */
  locked?: VehicleField[];
}

/** Campos do cadastro de veículo. Vão dentro de um <FormGrid>. */
export function VehicleFields({ value, onChange, locked = [] }: Props) {
  const isLocked = (f: VehicleField) => locked.includes(f);
  return (
    <>
      <FieldLabel>
        Placa *
        <Input
          value={value.plate}
          onChange={(e) => onChange({ plate: e.target.value.toUpperCase().slice(0, 8) })}
          placeholder="ABC1D23"
          pattern="[A-Z]{3}-?\d[A-Z0-9]\d{2}"
          title="Use o formato ABC1D23 ou ABC-1234."
          autoComplete="off"
          required
          disabled={isLocked('plate')}
        />
      </FieldLabel>
      <FieldLabel>
        Modelo
        <Input
          value={value.model}
          onChange={(e) => onChange({ model: e.target.value })}
          placeholder="VW Delivery 11.180"
          disabled={isLocked('model')}
        />
      </FieldLabel>
      <FieldLabel>
        Capacidade de carga (kg)
        <Input
          type="number"
          min={1}
          step={1}
          value={value.capacity_kg}
          onChange={(e) => onChange({ capacity_kg: e.target.value })}
          placeholder="6000"
          disabled={isLocked('capacity_kg')}
        />
      </FieldLabel>
      <FieldLabel>
        Rastreador *
        <Select
          value={value.tracker_provider}
          onChange={(e) => onChange({ tracker_provider: e.target.value as TrackerProvider })}
          disabled={isLocked('tracker_provider')}
        >
          {TRACKERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
      </FieldLabel>
      <FieldLabel>
        Código do veículo no rastreador *
        <Input
          value={value.tracker_external_id}
          onChange={(e) => onChange({ tracker_external_id: e.target.value })}
          placeholder="Como aparece no portal do rastreador"
          autoComplete="off"
          required
          disabled={isLocked('tracker_external_id')}
        />
      </FieldLabel>
      <FieldLabel>
        Combustível
        <Select
          value={value.fuel_type}
          onChange={(e) => onChange({ fuel_type: e.target.value as FuelType | '' })}
          disabled={isLocked('fuel_type')}
        >
          <option value="">Selecione</option>
          {(Object.keys(FUEL_LABEL) as FuelType[]).map((f) => <option key={f} value={f}>{FUEL_LABEL[f]}</option>)}
        </Select>
      </FieldLabel>
      <FieldLabel>
        Consumo médio (km/l)
        <Input
          type="number"
          min={0.5}
          max={50}
          step={0.1}
          value={value.km_per_liter}
          onChange={(e) => onChange({ km_per_liter: e.target.value })}
          placeholder="5,5"
          disabled={isLocked('km_per_liter')}
        />
      </FieldLabel>
      <FieldLabel>
        Rodado traseiro
        <Select
          value={value.axle_layout}
          onChange={(e) => onChange({ axle_layout: e.target.value as AxleLayout })}
          disabled={isLocked('axle_layout')}
        >
          {(Object.keys(AXLE_LABEL) as AxleLayout[]).map((a) => <option key={a} value={a}>{AXLE_LABEL[a]}</option>)}
        </Select>
      </FieldLabel>
    </>
  );
}
