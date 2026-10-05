import { useDrivers, useTires, useVehicles } from '../api/queries';
import { TireScreen } from '../components/Tires';
import { Card, FieldLabel, Muted, Select } from '../components/ui';

/** Aba "Pneus" da tela de Veículos: diagrama, ficha e simulação dos pneus do veículo escolhido. */
export function VehicleTiresTab({ vehicleId, onChangeVehicle }: { vehicleId: number | null; onChangeVehicle: (id: number) => void }) {
  const vehicles = useVehicles();
  const drivers = useDrivers();
  const tires = useTires();
  const list = vehicles.data ?? [];
  const vehicle = list.find((v) => v.id === vehicleId) ?? list[0];
  const driverName = (id: number | null) => drivers.data?.find((d) => d.id === id)?.name;

  if (vehicles.isLoading) return <Muted>Carregando…</Muted>;
  if (!vehicle) return <Card><Muted>Nenhum veículo cadastrado ainda.</Muted></Card>;
  return (
    <>
      <FieldLabel style={{ maxWidth: 360, marginBottom: 16 }}>
        Veículo
        <Select value={vehicle.id} onChange={(e) => onChangeVehicle(Number(e.target.value))}>
          {list.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate}{v.model ? ` · ${v.model}` : ''}{driverName(v.current_driver_id) ? ` · ${driverName(v.current_driver_id)}` : ''}
            </option>
          ))}
        </Select>
      </FieldLabel>
      <TireScreen vehicle={vehicle} tires={(tires.data ?? []).filter((t) => t.vehicle_id === vehicle.id)} />
    </>
  );
}
