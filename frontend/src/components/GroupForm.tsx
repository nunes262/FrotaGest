import { useState, type FormEvent } from 'react';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import type { ChatUser } from '../api/types';
import { roleLabel, searchKey } from '../format';
import { Avatar } from './Avatar';
import { SearchInput } from './SearchInput';
import { Button, ErrorText, FieldLabel, FormActions, Input, Muted } from './ui';

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
  margin-bottom: ${({ theme }) => theme.space(3)};
  ${FieldLabel} ${Input} { width: 100%; }
`;

const ParticipantsHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  strong { font-size: ${({ theme }) => theme.font.size.lg}; color: ${({ theme }) => theme.color.textStrong}; }
  span { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const People = styled.div`
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius};
`;

const CheckRow = styled.label<{ $strong?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  cursor: pointer;
  font-weight: ${({ theme, $strong }) => ($strong ? theme.font.weight.semibold : theme.font.weight.regular)};
  &:last-child { border-bottom: 0; }
  &:hover { background: ${({ theme }) => theme.color.background}; }

  input {
    width: 20px;
    height: 20px;
    margin: 0;
    flex-shrink: 0;
    accent-color: ${({ theme }) => theme.color.primary};
  }
`;

const PersonText = styled.span`
  display: flex;
  flex-direction: column;
  min-width: 0;
  small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

interface Props {
  contacts: ChatUser[];
  initialName?: string;
  initialMemberIds?: number[];
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (value: { name: string; member_ids: number[] }) => void;
  onCancel: () => void;
}

/** Nome e participantes de um grupo; serve para criar e para editar. */
export function GroupForm({ contacts, initialName = '', initialMemberIds = [], submitLabel, pending, error, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [members, setMembers] = useState<number[]>(initialMemberIds);
  const [query, setQuery] = useState('');

  const drivers = contacts.filter((c) => c.role === 'driver');
  const visible = contacts.filter((c) => searchKey(c.name).includes(searchKey(query.trim())));
  const allDrivers = drivers.length > 0 && drivers.every((d) => members.includes(d.id));

  const toggle = (id: number) => setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const toggleAllDrivers = () =>
    setMembers((m) => {
      const driverIds = drivers.map((d) => d.id);
      return allDrivers ? m.filter((id) => !driverIds.includes(id)) : [...new Set([...m, ...driverIds])];
    });

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ name: name.trim(), member_ids: members });
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        <FieldLabel>
          Nome do grupo *
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Rota Vale do Aço" maxLength={120} required />
        </FieldLabel>

        <ParticipantsHeader>
          <strong>Participantes</strong>
          <span aria-live="polite">{members.length === 1 ? '1 selecionado' : `${members.length} selecionados`}</span>
        </ParticipantsHeader>
        <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar pelo nome" aria-label="Buscar participante" />
        <People role="group" aria-label="Participantes do grupo">
          {drivers.length > 1 && !query.trim() && (
            <CheckRow $strong>
              <input type="checkbox" checked={allDrivers} onChange={toggleAllDrivers} />
              Todos os motoristas ({drivers.length})
            </CheckRow>
          )}
          {visible.map((c) => (
            <CheckRow key={c.id}>
              <input type="checkbox" checked={members.includes(c.id)} onChange={() => toggle(c.id)} />
              <Avatar name={c.name} size={32} />
              <PersonText>
                {c.name}
                <small>{roleLabel[c.role]}</small>
              </PersonText>
            </CheckRow>
          ))}
          {visible.length === 0 && <Muted style={{ padding: 12 }}>Ninguém com esse nome.</Muted>}
        </People>
        <Muted>Você entra no grupo automaticamente.</Muted>
        {Boolean(error) && <ErrorText role="alert">{errorMessage(error)}</ErrorText>}
      </Stack>
      <FormActions>
        <Button type="button" $variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={pending || !name.trim() || members.length === 0}>
          {pending ? 'Salvando…' : submitLabel}
        </Button>
      </FormActions>
    </form>
  );
}
