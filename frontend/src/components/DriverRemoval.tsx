import { useEffect, useState, type FormEvent } from 'react';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { usePurgeDriver, useReactivateDriver, useRemoveDriver } from '../api/queries';
import type { Driver, DriverPurge, DriverRemoval, Vehicle } from '../api/types';
import { searchKey } from '../format';
import { Dialog } from './Dialog';
import { Button, ErrorText, FieldLabel, FormActions, Input, Muted, Select } from './ui';

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const Consequences = styled.ul`
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: ${({ theme }) => theme.font.size.md};
`;

const Note = styled.p`
  margin: 0;
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.neutralTint};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

interface RemoveProps {
  driver: Driver | null;
  vehicle: Vehicle | undefined;
  onClose: () => void;
  onRemoved: (result: DriverRemoval) => void;
}

/** Confirmação de remoção (demissão): explica o que muda antes de tirar o acesso. */
export function RemoveDriverDialog({ driver, vehicle, onClose, onRemoved }: RemoveProps) {
  const remove = useRemoveDriver();
  useEffect(() => remove.reset(), [driver?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={Boolean(driver)} size="small" title={driver ? `Remover ${driver.name}?` : 'Remover motorista'} onClose={onClose}>
      {driver && (
        <Stack>
          <Muted>{driver.name.split(' ')[0]} perde o acesso ao app na hora. Além disso:</Muted>
          <Consequences>
            {vehicle && <li>O veículo {vehicle.plate} fica sem motorista e pode ir para outro.</li>}
            <li>As entregas que ainda não foram feitas voltam para a fila de carregamento.</li>
            <li>Se estiver em rota, ela é encerrada com os km rodados até agora.</li>
            <li>Sai dos grupos do chat.</li>
          </Consequences>
          <Note>
            O histórico (rotas, km, comprovantes de entrega e conversas) continua guardado: a Lei 13.103 exige que a
            empresa consiga comprovar a jornada. Se ele voltar, dá para reativar.
          </Note>
          {remove.isError && <ErrorText role="alert">{errorMessage(remove.error)}</ErrorText>}
          <FormActions>
            <Button type="button" $variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="button" disabled={remove.isPending} onClick={() => remove.mutate(driver.id, { onSuccess: onRemoved })}>
              {remove.isPending ? 'Removendo…' : 'Remover motorista'}
            </Button>
          </FormActions>
        </Stack>
      )}
    </Dialog>
  );
}

interface ReactivateProps {
  driver: Driver | null;
  freeVehicles: Vehicle[];
  onClose: () => void;
  onReactivated: (driver: Driver) => void;
}

/** Recontratação: volta o acesso, com um veículo livre e uma senha nova se quiser. */
export function ReactivateDriverDialog({ driver, freeVehicles, onClose, onReactivated }: ReactivateProps) {
  const reactivate = useReactivateDriver();
  const [vehicleId, setVehicleId] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    setVehicleId('');
    setPassword('');
    reactivate.reset();
  }, [driver?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!driver) return;
    reactivate.mutate(
      { id: driver.id, vehicle_id: vehicleId ? Number(vehicleId) : null, password: password || null },
      { onSuccess: onReactivated },
    );
  }

  return (
    <Dialog open={Boolean(driver)} size="small" title={driver ? `Reativar ${driver.name}` : 'Reativar motorista'} onClose={onClose}>
      {driver && (
        <form onSubmit={onSubmit}>
          <Stack>
            <Muted>O motorista volta a entrar no app com o CPF. O histórico de antes continua lá.</Muted>
            <FieldLabel>
              Veículo
              <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">Sem veículo por enquanto</option>
                {freeVehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}{v.model ? ` · ${v.model}` : ''}</option>)}
              </Select>
            </FieldLabel>
            <FieldLabel>
              Nova senha (opcional)
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} autoComplete="new-password" />
            </FieldLabel>
            <Muted style={{ fontSize: 12 }}>Sem senha nova, vale a que ele usava antes.</Muted>
            {reactivate.isError && <ErrorText role="alert">{errorMessage(reactivate.error)}</ErrorText>}
            <FormActions>
              <Button type="button" $variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={reactivate.isPending}>{reactivate.isPending ? 'Reativando…' : 'Reativar'}</Button>
            </FormActions>
          </Stack>
        </form>
      )}
    </Dialog>
  );
}

const Danger = styled.p`
  margin: 0;
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.dangerTint};
  color: ${({ theme }) => theme.color.dangerInk};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

interface PurgeProps {
  driver: Driver | null;
  onClose: () => void;
  onPurged: (result: DriverPurge) => void;
}

/** Exclusão definitiva de um motorista removido. Pede para digitar o nome, porque não dá para desfazer. */
export function PurgeDriverDialog({ driver, onClose, onPurged }: PurgeProps) {
  const purge = usePurgeDriver();
  const [typed, setTyped] = useState('');
  useEffect(() => {
    setTyped('');
    purge.reset();
  }, [driver?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = driver !== null && searchKey(typed.trim()) === searchKey(driver.name.trim());
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (driver && matches) purge.mutate(driver.id, { onSuccess: onPurged });
  }

  return (
    <Dialog open={Boolean(driver)} size="small" title={driver ? `Excluir ${driver.name} de vez?` : 'Excluir motorista'} onClose={onClose}>
      {driver && (
        <form onSubmit={onSubmit}>
          <Stack>
            <Muted>Isso apaga para sempre, sem como desfazer:</Muted>
            <Consequences>
              <li>O cadastro (CPF, CNH, telefone e senha).</li>
              <li>As rotas, os km e os pontos de GPS dele.</li>
              <li>As pausas e os comprovantes de entrega, com as fotos.</li>
              <li>Os valores lançados em Pagamentos (a pagar e pagos).</li>
              <li>As mensagens dele no chat e as conversas individuais com ele.</li>
            </Consequences>
            <Note>
              As entregas que ele fez continuam no histórico da empresa, sem o nome dele. Os km rodados com cada veículo
              continuam contando no desgaste dos pneus, mas saem dos custos por período.
            </Note>
            <Danger>
              Sem esse histórico, a empresa perde a prova da jornada dele (Lei 13.103), que pode ser pedida numa ação
              trabalhista.
            </Danger>
            <FieldLabel>
              Para confirmar, digite o nome do motorista: {driver.name}
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
            </FieldLabel>
            {purge.isError && <ErrorText role="alert">{errorMessage(purge.error)}</ErrorText>}
            <FormActions>
              <Button type="button" $variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={!matches || purge.isPending}>{purge.isPending ? 'Excluindo…' : 'Excluir de vez'}</Button>
            </FormActions>
          </Stack>
        </form>
      )}
    </Dialog>
  );
}
