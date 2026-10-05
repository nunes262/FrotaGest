import { useState, type FormEvent } from 'react';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useAuthImage, useChecklist, useChecklistItems, useCreateChecklist } from '../api/queries';
import type { ChecklistAnswer } from '../api/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { compressImage } from './Proof';
import { Button, ErrorText, FieldLabel, FormActions, Input, Muted, Pill } from './ui';

const Items = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;

  > li { padding: 12px 0; border-bottom: 1px solid ${({ theme }) => theme.color.border}; }
  > li > div:first-child { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  textarea {
    width: 100%;
    margin-top: 8px;
    min-height: 56px;
    padding: 8px 10px;
    border: 1px solid ${({ theme }) => theme.color.borderStrong};
    border-radius: ${({ theme }) => theme.radius};
    font: inherit;
  }
`;

const Toggle = styled.div`
  display: inline-flex;
  border: 1px solid ${({ theme }) => theme.color.borderStrong};
  border-radius: ${({ theme }) => theme.radius};
  overflow: hidden;

  button {
    all: unset;
    cursor: pointer;
    padding: 6px 14px;
    font-weight: ${({ theme }) => theme.font.weight.semibold};
    font-size: ${({ theme }) => theme.font.size.md};
  }
  button[aria-pressed='true'].ok { background: ${({ theme }) => theme.color.success}; color: #fff; }
  button[aria-pressed='true'].bad { background: ${({ theme }) => theme.color.danger}; color: #fff; }
  button:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; }
`;

const PhotoLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.primary};
  cursor: pointer;
  input { position: absolute; width: 1px; height: 1px; opacity: 0; }
`;

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

interface Answer {
  ok: boolean | null;
  note: string;
  photo: File | null;
}

/** Checklist antes de sair: cada item OK ou com problema (com observação e foto). Ao terminar, a rota começa. */
export function ChecklistDialog({ open, onClose, onDone, starting }: {
  open: boolean;
  onClose: () => void;
  onDone: (checklistId: number) => void;
  starting: boolean;
}) {
  const items = useChecklistItems();
  const create = useCreateChecklist();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [odometer, setOdometer] = useState('');
  const [preparing, setPreparing] = useState(false);
  const list = items.data ?? [];
  const get = (key: string): Answer => answers[key] ?? { ok: null, note: '', photo: null };
  const set = (key: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [key]: { ...get(key), ...patch } }));
  const answered = list.every((i) => get(i.key).ok !== null);
  const issues = list.filter((i) => get(i.key).ok === false);
  const missingNote = issues.some((i) => get(i.key).note.trim().length < 3);
  const busy = preparing || create.isPending || starting;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPreparing(true);
    const photos: Record<string, Blob> = {};
    for (const i of issues) {
      const file = get(i.key).photo;
      if (file) photos[i.key] = await compressImage(file);
    }
    setPreparing(false);
    const payload: ChecklistAnswer[] = list.map((i) => ({ key: i.key, ok: get(i.key).ok === true, note: get(i.key).note.trim() || null }));
    create.mutate({ answers: payload, photos, odometer }, { onSuccess: (c) => onDone(c.id) });
  }

  return (
    <Dialog open={open} title="Checklist antes de sair" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <Stack>
          <Muted>Confira o veículo e a carga. O que tiver problema vai para a base com a observação e a foto.</Muted>
          <FieldLabel>
            Hodômetro (km)
            <Input type="number" inputMode="numeric" min={0} value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="opcional" />
          </FieldLabel>
          <div>
            <Button type="button" $variant="secondary" style={{ height: 36 }}
              onClick={() => setAnswers((a) => Object.fromEntries(list.map((i) => [i.key, a[i.key]?.ok === false ? a[i.key] : { ok: true, note: '', photo: null }])))}>
              <Icon name="check" size={18} />
              Marcar o resto como OK
            </Button>
          </div>
          <Items>
            {list.map((i) => {
              const a = get(i.key);
              return (
                <li key={i.key}>
                  <div>
                    <span>{i.label}</span>
                    <Toggle role="group" aria-label={i.label}>
                      <button type="button" className="ok" aria-pressed={a.ok === true} onClick={() => set(i.key, { ok: true })}>OK</button>
                      <button type="button" className="bad" aria-pressed={a.ok === false} onClick={() => set(i.key, { ok: false })}>Problema</button>
                    </Toggle>
                  </div>
                  {a.ok === false && (
                    <>
                      <textarea aria-label={`O que há de errado em ${i.label}`} placeholder="O que há de errado?" maxLength={300}
                        value={a.note} onChange={(e) => set(i.key, { note: e.target.value })} required />
                      <PhotoLabel>
                        <input type="file" accept="image/*" capture="environment" aria-label={`Foto de ${i.label}`}
                          onChange={(e) => set(i.key, { photo: e.target.files?.[0] ?? null })} />
                        <Icon name="camera" size={18} />
                        {a.photo ? `Foto: ${a.photo.name}` : 'Tirar foto (opcional)'}
                      </PhotoLabel>
                    </>
                  )}
                </li>
              );
            })}
          </Items>
          {create.isError && <ErrorText role="alert">{errorMessage(create.error)}</ErrorText>}
          <FormActions>
            <Button type="button" $variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!answered || missingNote || busy}>
              {busy ? 'Iniciando…' : issues.length ? `Sair com ${issues.length} ${issues.length === 1 ? 'pendência' : 'pendências'}` : 'Tudo certo: iniciar rota'}
            </Button>
          </FormActions>
        </Stack>
      </form>
    </Dialog>
  );
}

const ViewItem = styled.li`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 0;
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  img { max-width: 100%; max-height: 240px; border-radius: ${({ theme }) => theme.radius}; object-fit: contain; align-self: flex-start; }
`;

function ItemPhoto({ checklistId, itemKey, label }: { checklistId: number; itemKey: string; label: string }) {
  const image = useAuthImage(`/checklists/${checklistId}/photos/${itemKey}`);
  return image.data ? <img src={image.data} alt={`Foto de ${label}`} /> : null;
}

/** Checklist feito antes da rota (gestor e motorista). */
export function ChecklistView({ checklistId, onClose }: { checklistId: number | null; onClose: () => void }) {
  const checklist = useChecklist(checklistId);
  const c = checklist.data;
  return (
    <Dialog open={checklistId !== null} size="small" title="Checklist antes de sair" onClose={onClose}>
      {checklist.isLoading && <Muted>Carregando…</Muted>}
      {c && (
        <Stack>
          <Muted>
            {c.driver_name} · {c.plate} · {new Date(c.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            {c.odometer_km !== null && ` · hodômetro ${c.odometer_km.toLocaleString('pt-BR')} km`}
          </Muted>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {c.items.map((i) => (
              <ViewItem key={i.key}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  {i.label}
                  {i.ok ? <Pill $tone="success">OK</Pill> : <Pill $tone="danger">Problema</Pill>}
                </span>
                {i.note && <Muted>“{i.note}”</Muted>}
                {i.has_photo && <ItemPhoto checklistId={c.id} itemKey={i.key} label={i.label} />}
              </ViewItem>
            ))}
          </ul>
        </Stack>
      )}
    </Dialog>
  );
}

/** Selo do checklist na rota: OK, com pendências ou sem checklist. */
export function ChecklistBadge({ checklist, onOpen }: { checklist: { id: number; issues: number } | null; onOpen: (id: number) => void }) {
  if (!checklist) return <Pill $tone="caution">Saiu sem checklist</Pill>;
  return (
    <button type="button" onClick={() => onOpen(checklist.id)} style={{ all: 'unset', cursor: 'pointer' }}
      aria-label={checklist.issues ? `Checklist com ${checklist.issues} pendências` : 'Checklist OK'}>
      {checklist.issues
        ? <Pill $tone="danger">Checklist: {checklist.issues} {checklist.issues === 1 ? 'pendência' : 'pendências'}</Pill>
        : <Pill $tone="success">Checklist OK</Pill>}
    </button>
  );
}
