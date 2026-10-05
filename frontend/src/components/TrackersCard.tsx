import { useState, type FormEvent } from 'react';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useConnectTracker, useDisconnectTracker, useTrackerCheck, useTrackers } from '../api/queries';
import type { TrackerVehicle } from '../api/types';
import { TrackerCheckResult } from './TrackerCheckResult';
import { Button, Card, CardTitle, ErrorText, FieldLabel, FormActions, FormGrid, Input, Muted, Pill } from './ui';

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  strong { font-size: ${({ theme }) => theme.font.size.lg}; color: ${({ theme }) => theme.color.textStrong}; }
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius};

  li { padding: 12px 16px; }
  li + li { border-top: 1px solid ${({ theme }) => theme.color.border}; }
  li > div { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  strong { color: ${({ theme }) => theme.color.textStrong}; }
  small { display: block; font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  ${Button} { height: 36px; padding: 0 12px; }
`;

const normalizePlate = (p: string | null) => (p ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 7);

function SascarVehicle({ v }: { v: TrackerVehicle }) {
  const check = useTrackerCheck();
  const plateDiffers = v.vehicle_plate && v.plate && normalizePlate(v.plate) !== normalizePlate(v.vehicle_plate);
  return (
    <li>
      <div>
        <span>
          <strong>{v.plate ?? 'Sem placa'}</strong> · código {v.external_id}
          <small>
            {v.description}
            {v.vehicle_id
              ? ` · no FrotaGest como ${v.vehicle_plate}${plateDiffers ? ' (placa diferente da Sascar: confira o cadastro)' : ''}`
              : ' · não cadastrado no FrotaGest'}
          </small>
        </span>
        {v.vehicle_id && (
          <Button type="button" $variant="secondary" disabled={check.isPending} onClick={() => check.mutate(v.vehicle_id!)}>
            {check.isPending ? 'Verificando…' : 'Verificar agora'}
          </Button>
        )}
      </div>
      <TrackerCheckResult result={check.data} error={check.error} />
    </li>
  );
}

/** Configurações: conexão com a Sascar (usuário e senha de integração do SasIntegra). */
export function TrackersCard() {
  const trackers = useTrackers();
  const connect = useConnectTracker();
  const disconnect = useDisconnectTracker();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState(false);
  const sascar = trackers.data?.find((t) => t.provider === 'sascar');
  const showForm = !sascar?.configured || editing;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    connect.mutate(
      { provider: 'sascar', user, password },
      { onSuccess: () => { setPassword(''); setEditing(false); } },
    );
  }

  return (
    <Card aria-labelledby="trackers-title">
      <Stack>
        <div>
          <CardTitle id="trackers-title">Rastreadores</CardTitle>
          <Muted style={{ marginTop: 4 }}>
            Conecte a conta de integração do rastreador para o FrotaGest buscar as posições sozinho, a cada minuto.
          </Muted>
        </div>
        <Header>
          <strong>Sascar</strong>
          {sascar?.configured ? <Pill $tone="success">Conectado como {sascar.user}</Pill> : <Pill $tone="neutral">Não conectado</Pill>}
        </Header>

        {showForm ? (
          <form onSubmit={onSubmit} aria-label="Conectar a Sascar">
            <Stack>
              <Muted style={{ fontSize: 12 }}>
                Use o usuário e a senha de integrador do SasIntegra, que a Sascar libera para a sua conta (peça à central de
                atendimento ou ao consultor). Nem sempre é o mesmo login do Portal de Serviços. A senha fica guardada só no
                servidor do FrotaGest e nunca aparece de volta na tela.
              </Muted>
              <FormGrid>
                <FieldLabel>
                  Usuário de integração
                  <Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" required />
                </FieldLabel>
                <FieldLabel>
                  Senha de integração
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
                </FieldLabel>
              </FormGrid>
              {connect.isError && <ErrorText role="alert">{errorMessage(connect.error)}</ErrorText>}
              <FormActions>
                {editing && <Button type="button" $variant="secondary" onClick={() => setEditing(false)}>Cancelar</Button>}
                <Button type="submit" disabled={connect.isPending}>{connect.isPending ? 'Testando na Sascar…' : 'Conectar e testar'}</Button>
              </FormActions>
            </Stack>
          </form>
        ) : (
          <FormActions style={{ justifyContent: 'flex-start' }}>
            <Button type="button" $variant="secondary" onClick={() => { setUser(sascar?.user ?? ''); setEditing(true); }}>Trocar credenciais</Button>
            <Button
              type="button"
              $variant="secondary"
              disabled={disconnect.isPending}
              onClick={() => window.confirm('Desconectar a Sascar? As posições param de chegar.') && disconnect.mutate('sascar')}
            >
              Desconectar
            </Button>
          </FormActions>
        )}

        {connect.data && connect.data.vehicles.length > 0 && (
          <>
            <Muted>Conexão funcionando. Veículos liberados para a integração:</Muted>
            <List aria-label="Veículos da Sascar">
              {connect.data.vehicles.map((v) => <SascarVehicle key={v.external_id} v={v} />)}
            </List>
          </>
        )}
        {connect.data && connect.data.vehicles.length === 0 && (
          <Muted>Conexão funcionando, mas nenhum veículo está liberado para essa integração na Sascar.</Muted>
        )}
      </Stack>
    </Card>
  );
}
