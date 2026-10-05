import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import {
  useContacts,
  useConversations,
  useCreateConversation,
  useMarkRead,
  useMessages,
  useSendMessage,
  useUpdateGroup,
} from '../api/queries';
import type { ChatUser, Conversation } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { Dialog } from '../components/Dialog';
import { GroupForm } from '../components/GroupForm';
import { Icon } from '../components/Icon';
import { SearchInput } from '../components/SearchInput';
import { Button, CountBadge, ErrorText, Muted, PageHeader, SrOnly } from '../components/ui';
import { fmtChatTime, fmtDaySeparator, fmtTime, localDateISO, roleLabel, searchKey } from '../format';

const Frame = styled.div`
  display: flex;
  flex-wrap: wrap;
  min-height: 600px;
  background: ${({ theme }) => theme.color.surface};
  border-radius: ${({ theme }) => theme.radius};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  overflow: hidden;
`;

const Sidebar = styled.aside`
  flex: 1 1 300px;
  min-width: 0;
  border-right: 1px solid ${({ theme }) => theme.color.border};
  display: flex;
  flex-direction: column;
`;

const SidebarSearch = styled.div`
  padding: ${({ theme }) => theme.space(2)};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
`;

const SidebarList = styled.div`
  flex: 1;
  max-height: 70vh;
  overflow-y: auto;
`;

const SectionTitle = styled.h2`
  padding: ${({ theme }) => `${theme.space(2)} ${theme.space(2)} ${theme.space(1)}`};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.textSoft};
`;

const Item = styled.button<{ $active: boolean }>`
  all: unset;
  box-sizing: border-box;
  width: 100%;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px ${({ theme }) => theme.space(2)};
  background: ${({ theme, $active }) => ($active ? theme.color.primaryTint : 'transparent')};
  &:hover { background: ${({ theme, $active }) => ($active ? theme.color.primaryTint : theme.color.background)}; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; outline-offset: -2px; }
`;

const ItemText = styled.span`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ItemLine = styled.span`
  display: flex;
  align-items: center;
  gap: 8px;

  time { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; flex-shrink: 0; }
`;

const ellipsis = `
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ItemName = styled.strong`
  ${ellipsis}
  font-size: ${({ theme }) => theme.font.size.md};
  color: ${({ theme }) => theme.color.textStrong};
`;

const Preview = styled.span`
  ${ellipsis}
  font-size: 13px;
  color: ${({ theme }) => theme.color.textSoft};
`;

const Thread = styled.section`
  flex: 999 1 480px;
  min-width: 0;
  display: flex;
  flex-direction: column;
`;

const ThreadHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: ${({ theme }) => `${theme.space(2)} ${theme.space(3)}`};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};

  > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  strong { font-size: ${({ theme }) => theme.font.size.lg}; color: ${({ theme }) => theme.color.textStrong}; }
  small {
    font-size: ${({ theme }) => theme.font.size.sm};
    color: ${({ theme }) => theme.color.textSoft};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const Messages = styled.div`
  flex: 1;
  min-height: 360px;
  max-height: 60vh;
  overflow-y: auto;
  padding: ${({ theme }) => theme.space(3)};
  background: ${({ theme }) => theme.color.background};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const DaySeparator = styled.div`
  align-self: center;
  padding: 4px 12px;
  border-radius: 12px;
  background: ${({ theme }) => theme.color.surface};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textSoft};
  &::first-letter { text-transform: uppercase; }
`;

const Bubble = styled.div<{ $mine: boolean }>`
  align-self: ${({ $mine }) => ($mine ? 'flex-end' : 'flex-start')};
  max-width: min(70%, 520px);
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme, $mine }) => ($mine ? theme.color.primary : theme.color.surface)};
  color: ${({ theme, $mine }) => ($mine ? theme.color.textInvert : theme.color.text)};
  box-shadow: ${({ theme, $mine }) => ($mine ? 'none' : theme.shadow.soft)};
  display: flex;
  flex-direction: column;
  gap: 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;

  b { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.primary}; }
  small { font-size: ${({ theme }) => theme.font.size.xs}; align-self: flex-end; opacity: 0.85; }
`;

const Empty = styled(Muted)`
  margin: auto;
  text-align: center;
  max-width: 320px;
`;

const Composer = styled.form`
  display: flex;
  align-items: flex-end;
  gap: ${({ theme }) => theme.space(1)};
  padding: ${({ theme }) => `${theme.space(2)} ${theme.space(3)}`};
  border-top: 1px solid ${({ theme }) => theme.color.border};
`;

const MessageBox = styled.textarea`
  flex: 1;
  min-width: 0;
  min-height: 44px;
  max-height: 140px;
  resize: none;
  field-sizing: content;
  padding: 11px 12px;
  border: 1px solid ${({ theme }) => theme.color.borderStrong};
  border-radius: ${({ theme }) => theme.radius};
  font-size: ${({ theme }) => theme.font.size.md};
  line-height: 1.4;
  background: ${({ theme }) => theme.color.surface};
  &:disabled { background: ${({ theme }) => theme.color.background}; }
`;

const firstName = (name: string) => name.split(' ')[0];

interface ItemProps {
  name: string;
  group?: boolean;
  conversation?: Conversation;
  emptyText: string;
  active: boolean;
  meId?: number;
  onClick: () => void;
}

function ConversationItem({ name, group = false, conversation, emptyText, active, meId, onClick }: ItemProps) {
  const unread = active ? 0 : conversation?.unread_count ?? 0;
  let preview = emptyText;
  if (conversation?.last_message) {
    const mine = conversation.last_message_sender_id === meId;
    const who = mine ? 'Você: ' : group && conversation.last_message_sender_name ? `${firstName(conversation.last_message_sender_name)}: ` : '';
    preview = who + conversation.last_message;
  }
  return (
    <Item type="button" $active={active} aria-current={active || undefined} onClick={onClick}>
      <Avatar name={name} group={group} />
      <ItemText>
        <ItemLine>
          <ItemName>{name}</ItemName>
          {conversation?.last_message_at && <time dateTime={conversation.last_message_at}>{fmtChatTime(conversation.last_message_at)}</time>}
        </ItemLine>
        <ItemLine>
          <Preview>{preview}</Preview>
          {unread > 0 && (
            <>
              <CountBadge aria-hidden="true">{unread}</CountBadge>
              <SrOnly>, {unread} não lidas</SrOnly>
            </>
          )}
        </ItemLine>
      </ItemText>
    </Item>
  );
}

export function ChatPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const conversations = useConversations();
  const contacts = useContacts();
  const [activeId, setActiveId] = useState<number>();
  const [query, setQuery] = useState('');
  const [groupDialog, setGroupDialog] = useState<'new' | 'edit' | null>(null);
  const [draft, setDraft] = useState('');

  const messages = useMessages(activeId);
  const send = useSendMessage(activeId);
  const createDirect = useCreateConversation();
  const createGroup = useCreateConversation();
  const updateGroup = useUpdateGroup();
  const { mutate: markRead } = useMarkRead();
  const threadRef = useRef<HTMLElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const convs = conversations.data ?? [];
  const active = convs.find((c) => c.id === activeId);

  useEffect(() => {
    if (!activeId && conversations.data?.length) setActiveId(conversations.data[0].id);
  }, [activeId, conversations.data]);

  // Abrir a conversa marca as mensagens como lidas (e de novo quando chega outra com ela aberta)
  const activeUnread = active?.unread_count ?? 0;
  useEffect(() => {
    if (activeId && activeUnread > 0) markRead(activeId);
  }, [activeId, activeUnread, markRead]);

  // Rola só a caixa de mensagens até a última (sem mexer na página)
  useEffect(() => {
    const box = messagesRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages.data]);

  // Conversa individual de cada contato, se já existir
  const directWith = new Map<number, Conversation>();
  for (const c of convs) {
    const other = c.kind === 'direct' ? c.members.find((m) => m.id !== user?.id) : undefined;
    if (other) directWith.set(other.id, c);
  }

  const term = searchKey(query.trim());
  const matches = (name: string) => searchKey(name).includes(term);
  const groups = convs.filter((c) => c.kind === 'group' && matches(c.name));
  const people = (contacts.data ?? [])
    .filter((p) => matches(p.name))
    .map((person) => ({ person, conversation: directWith.get(person.id) }))
    .sort(
      (a, b) =>
        (b.conversation?.last_message_at ?? '').localeCompare(a.conversation?.last_message_at ?? '') ||
        a.person.name.localeCompare(b.person.name, 'pt-BR'),
    );
  const sections: { title: string; list: typeof people }[] = isAdmin
    ? [
        { title: 'Motoristas', list: people.filter((p) => p.person.role === 'driver') },
        { title: 'Gestores', list: people.filter((p) => p.person.role === 'admin') },
      ]
    : [{ title: 'Base', list: people }];

  function select(conversationId: number) {
    setActiveId(conversationId);
    setDraft('');
    // No celular a conversa fica embaixo da lista
    if (window.matchMedia('(max-width: 720px)').matches) threadRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  function openPerson(person: ChatUser, conversation?: Conversation) {
    if (conversation) return select(conversation.id);
    createDirect.mutate({ kind: 'direct', member_ids: [person.id] }, { onSuccess: (c) => select(c.id) });
  }

  function submit() {
    const body = draft.trim();
    if (!body || !active) return;
    // Limpa na hora para não perder o que for digitado enquanto envia; se falhar, devolve o texto
    setDraft('');
    send.mutate(body, { onError: () => setDraft((current) => current || body) });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const otherMember = active?.kind === 'direct' ? active.members.find((m) => m.id !== user?.id) : undefined;
  const subtitle = !active
    ? ''
    : active.kind === 'group'
      ? `${active.members.length} participantes: ${active.members.map((m) => (m.id === user?.id ? 'Você' : firstName(m.name))).join(', ')}`
      : otherMember ? roleLabel[otherMember.role] : '';
  const nothingFound = term && groups.length === 0 && people.length === 0;

  return (
    <>
      <PageHeader>
        <h1>Chat</h1>
        {isAdmin && (
          <Button type="button" onClick={() => setGroupDialog('new')}>
            <Icon name="plus" size={20} />
            Novo grupo
          </Button>
        )}
      </PageHeader>

      <Frame>
        <Sidebar aria-label="Conversas">
          <SidebarSearch>
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isAdmin ? 'Buscar motorista ou grupo' : 'Buscar conversa'}
              aria-label="Buscar conversa"
            />
          </SidebarSearch>
          <SidebarList>
            {nothingFound && <Muted style={{ padding: 16 }}>Ninguém encontrado para “{query.trim()}”.</Muted>}
            {groups.length > 0 && (
              <>
                <SectionTitle>Grupos</SectionTitle>
                {groups.map((c) => (
                  <ConversationItem
                    key={c.id}
                    name={c.name}
                    group
                    conversation={c}
                    emptyText="Sem mensagens"
                    active={c.id === activeId}
                    meId={user?.id}
                    onClick={() => select(c.id)}
                  />
                ))}
              </>
            )}
            {sections.map(
              (section) =>
                section.list.length > 0 && (
                  <Fragment key={section.title}>
                    <SectionTitle>{section.title}</SectionTitle>
                    {section.list.map(({ person, conversation }) => (
                      <ConversationItem
                        key={person.id}
                        name={person.name}
                        conversation={conversation}
                        emptyText="Iniciar conversa"
                        active={Boolean(conversation && conversation.id === activeId)}
                        meId={user?.id}
                        onClick={() => openPerson(person, conversation)}
                      />
                    ))}
                  </Fragment>
                ),
            )}
          </SidebarList>
        </Sidebar>

        <Thread ref={threadRef} aria-label={active ? `Conversa ${active.name}` : 'Conversa'}>
          <ThreadHeader>
            {active && <Avatar name={active.name} group={active.kind === 'group'} />}
            <div>
              <strong>{active?.name ?? 'Escolha uma conversa'}</strong>
              {subtitle && <small title={subtitle}>{subtitle}</small>}
            </div>
            {isAdmin && active?.kind === 'group' && (
              <Button type="button" $variant="secondary" onClick={() => setGroupDialog('edit')}>
                <Icon name="edit" size={20} />
                Editar grupo
              </Button>
            )}
          </ThreadHeader>
          <Messages ref={messagesRef}>
            {!active && <Empty>Escolha um motorista ou grupo na lista para conversar.</Empty>}
            {active && messages.data?.length === 0 && <Empty>Nenhuma mensagem ainda. Mande a primeira.</Empty>}
            {active &&
              messages.data?.map((m, i, list) => {
                const mine = m.sender_id === user?.id;
                const newDay = i === 0 || localDateISO(m.created_at) !== localDateISO(list[i - 1].created_at);
                return (
                  <Fragment key={m.id}>
                    {newDay && <DaySeparator>{fmtDaySeparator(m.created_at)}</DaySeparator>}
                    <Bubble $mine={mine}>
                      {!mine && active.kind === 'group' && <b>{m.sender_name}</b>}
                      <span>{m.body}</span>
                      <small>{fmtTime(m.created_at)}</small>
                    </Bubble>
                  </Fragment>
                );
              })}
          </Messages>
          {(send.isError || createDirect.isError) && (
            <ErrorText role="alert" style={{ margin: '0 24px' }}>{errorMessage(send.error ?? createDirect.error)}</ErrorText>
          )}
          <Composer onSubmit={onSubmit}>
            <MessageBox
              aria-label="Mensagem"
              aria-describedby="composer-hint"
              rows={1}
              placeholder={active ? `Mensagem para ${active.name}` : 'Escolha uma conversa'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!active}
            />
            <SrOnly id="composer-hint">Enter envia. Shift mais Enter quebra a linha.</SrOnly>
            <Button type="submit" disabled={!active || !draft.trim() || send.isPending}>
              <Icon name="send" size={20} />
              Enviar
            </Button>
          </Composer>
        </Thread>
      </Frame>

      <Dialog open={groupDialog === 'new'} title="Novo grupo" onClose={() => setGroupDialog(null)}>
        <GroupForm
          contacts={contacts.data ?? []}
          submitLabel="Criar grupo"
          pending={createGroup.isPending}
          error={createGroup.error}
          onCancel={() => setGroupDialog(null)}
          onSubmit={({ name, member_ids }) =>
            createGroup.mutate(
              { kind: 'group', name, member_ids },
              {
                onSuccess: (c) => {
                  setGroupDialog(null);
                  select(c.id);
                },
              },
            )
          }
        />
      </Dialog>

      <Dialog open={groupDialog === 'edit' && Boolean(active)} title="Editar grupo" onClose={() => setGroupDialog(null)}>
        {active && (
          <GroupForm
            contacts={contacts.data ?? []}
            initialName={active.name}
            initialMemberIds={active.members.filter((m) => m.id !== user?.id).map((m) => m.id)}
            submitLabel="Salvar alterações"
            pending={updateGroup.isPending}
            error={updateGroup.error}
            onCancel={() => setGroupDialog(null)}
            onSubmit={({ name, member_ids }) =>
              updateGroup.mutate({ id: active.id, name, member_ids }, { onSuccess: () => setGroupDialog(null) })
            }
          />
        )}
      </Dialog>
    </>
  );
}
