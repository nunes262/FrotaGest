import { useEffect, useState, type FormEvent } from 'react';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useCreateExpense, useCreateFuelEntry, useVehicles } from '../api/queries';
import type { ExpenseKind } from '../api/types';
import { fmtBRL } from '../format';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { compressImage } from './Proof';
import { useGpsStatus } from './RunGps';
import { Button, ErrorText, FieldLabel, FormActions, FormGrid, Input, Muted, Select, SuccessText } from './ui';

export const EXPENSE_LABEL: Record<ExpenseKind, string> = {
  toll: 'Pedágio',
  parking: 'Estacionamento',
  unloading: 'Descarga (chapa)',
  meal: 'Alimentação',
  other: 'Outra',
};

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.space(1)};
`;

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const PhotoPick = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px;
  border: 2px dashed ${({ theme }) => theme.color.borderStrong};
  border-radius: ${({ theme }) => theme.radius};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  cursor: pointer;
  input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  &:focus-within { outline: 2px solid ${({ theme }) => theme.color.primary}; }
`;

const Check = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  input { width: 18px; height: 18px; accent-color: ${({ theme }) => theme.color.primary}; }
`;

const toNumber = (v: string) => Number(v.replace(',', '.'));

function PhotoField({ file, onChange, label }: { file: File | null; onChange: (f: File | null) => void; label: string }) {
  return (
    <PhotoPick>
      <input type="file" accept="image/*" capture="environment" required aria-label={label} onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      <Icon name="camera" size={22} />
      {file ? `Foto escolhida: ${file.name}` : `${label} *`}
    </PhotoPick>
  );
}

function FuelDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (queued: boolean) => void }) {
  const create = useCreateFuelEntry();
  const vehicle = useVehicles().data?.[0];
  const gps = useGpsStatus();
  const [form, setForm] = useState({ liters: '', total: '', odometer_km: '', fuel_type: '', full_tank: true, station: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const price = toNumber(form.liters) > 0 && toNumber(form.total) > 0 ? toNumber(form.total) / toNumber(form.liters) : null;

  useEffect(() => {
    if (!open) return;
    setForm({ liters: '', total: '', odometer_km: '', fuel_type: vehicle?.fuel_type ?? 'diesel', full_tank: true, station: '' });
    setPhoto(null);
    create.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!photo) return;
    setPreparing(true);
    const blob = await compressImage(photo);
    setPreparing(false);
    create.mutate(
      { ...form, liters: String(toNumber(form.liters)), total: String(toNumber(form.total)), photo: blob, latitude: gps.position?.[0], longitude: gps.position?.[1] },
      { onSuccess: (r) => { onSaved(r.queued); onClose(); } },
    );
  }

  return (
    <Dialog open={open} size="small" title="Abastecimento" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <Stack>
          <FormGrid>
            <FieldLabel>
              Litros *
              <Input type="number" inputMode="decimal" step="0.01" min="1" value={form.liters} onChange={(e) => set({ liters: e.target.value })} required />
            </FieldLabel>
            <FieldLabel>
              Valor total (R$) *
              <Input type="number" inputMode="decimal" step="0.01" min="1" value={form.total} onChange={(e) => set({ total: e.target.value })} required />
            </FieldLabel>
            <FieldLabel>
              Hodômetro (km)
              <Input type="number" inputMode="numeric" min="0" value={form.odometer_km} onChange={(e) => set({ odometer_km: e.target.value })} />
            </FieldLabel>
            <FieldLabel>
              Combustível
              <Select value={form.fuel_type} onChange={(e) => set({ fuel_type: e.target.value })}>
                <option value="diesel">Diesel S10</option>
                <option value="gasolina">Gasolina</option>
              </Select>
            </FieldLabel>
          </FormGrid>
          {price !== null && <Muted style={{ fontSize: 12 }}>{fmtBRL(price, 3)} o litro</Muted>}
          <FieldLabel>
            Posto
            <Input value={form.station} maxLength={120} onChange={(e) => set({ station: e.target.value })} placeholder="opcional" />
          </FieldLabel>
          <Check>
            <input type="checkbox" checked={form.full_tank} onChange={(e) => set({ full_tank: e.target.checked })} />
            Completei o tanque
          </Check>
          <PhotoField file={photo} onChange={setPhoto} label="Foto do cupom" />
          {create.isError && <ErrorText role="alert">{errorMessage(create.error)}</ErrorText>}
          <FormActions>
            <Button type="button" $variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!photo || preparing || create.isPending}>{preparing || create.isPending ? 'Enviando…' : 'Registrar abastecimento'}</Button>
          </FormActions>
        </Stack>
      </form>
    </Dialog>
  );
}

function ExpenseDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (queued: boolean) => void }) {
  const create = useCreateExpense();
  const [kind, setKind] = useState<ExpenseKind>('toll');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind('toll');
    setAmount('');
    setNote('');
    setPhoto(null);
    create.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!photo) return;
    setPreparing(true);
    const blob = await compressImage(photo);
    setPreparing(false);
    create.mutate(
      { kind, kindLabel: EXPENSE_LABEL[kind], amount: String(toNumber(amount)), note, photo: blob },
      { onSuccess: (r) => { onSaved(r.queued); onClose(); } },
    );
  }

  return (
    <Dialog open={open} size="small" title="Despesa da rota" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <Stack>
          <Muted>Pagou do seu bolso? Registre com o comprovante: depois que a base aprovar, o valor entra no seu “A receber”.</Muted>
          <FormGrid>
            <FieldLabel>
              Tipo *
              <Select value={kind} onChange={(e) => setKind(e.target.value as ExpenseKind)}>
                {(Object.keys(EXPENSE_LABEL) as ExpenseKind[]).map((k) => <option key={k} value={k}>{EXPENSE_LABEL[k]}</option>)}
              </Select>
            </FieldLabel>
            <FieldLabel>
              Valor (R$) *
              <Input type="number" inputMode="decimal" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </FieldLabel>
          </FormGrid>
          <FieldLabel>
            Observação
            <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: praça de pedágio de Betim" />
          </FieldLabel>
          <PhotoField file={photo} onChange={setPhoto} label="Foto do comprovante" />
          {create.isError && <ErrorText role="alert">{errorMessage(create.error)}</ErrorText>}
          <FormActions>
            <Button type="button" $variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!photo || !toNumber(amount) || preparing || create.isPending}>{preparing || create.isPending ? 'Enviando…' : 'Enviar para a base'}</Button>
          </FormActions>
        </Stack>
      </form>
    </Dialog>
  );
}

/** Botões "Abastecer" e "Despesa" do motorista (funcionam sem sinal: o registro vai quando o sinal voltar). */
export function DriverRecords() {
  const [open, setOpen] = useState<'fuel' | 'expense' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const saved = (queuedText: string, sentText: string) => (queued: boolean) => setMessage(queued ? queuedText : sentText);
  return (
    <div>
      <Row>
        <Button type="button" $variant="secondary" onClick={() => { setMessage(null); setOpen('fuel'); }}>
          <Icon name="fuel" size={18} />
          Abastecer
        </Button>
        <Button type="button" $variant="secondary" onClick={() => { setMessage(null); setOpen('expense'); }}>
          <Icon name="wallet" size={18} />
          Despesa (pedágio, estacionamento…)
        </Button>
      </Row>
      {message && <SuccessText role="status" style={{ marginTop: 12 }}>{message}</SuccessText>}
      <FuelDialog open={open === 'fuel'} onClose={() => setOpen(null)}
        onSaved={saved('Sem sinal: o abastecimento ficou guardado no celular e vai sozinho quando o sinal voltar.', 'Abastecimento enviado para a base.')} />
      <ExpenseDialog open={open === 'expense'} onClose={() => setOpen(null)}
        onSaved={saved('Sem sinal: a despesa ficou guardada no celular e vai sozinha quando o sinal voltar.', 'Despesa enviada para a base aprovar.')} />
    </div>
  );
}
