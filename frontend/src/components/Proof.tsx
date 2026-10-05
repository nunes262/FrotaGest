import { useEffect, useRef, useState, type FormEvent } from 'react';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useAuthImage, useProofPhoto, useRegisterOutcome } from '../api/queries';
import type { Delivery, FailureReason, LatLng } from '../api/types';
import { fmtDate, fmtTime, localDateISO } from '../format';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { Button, ErrorText, FieldLabel, FormActions, Input, Muted, Pill, Select } from './ui';

export const REASON_LABEL: Record<FailureReason, string> = {
  absent: 'Cliente ausente',
  refused: 'Recusou a mercadoria',
  address: 'Endereço não encontrado',
  other: 'Outro motivo',
};

const MAX_SIDE = 1600;

/** Reduz a foto no celular antes de enviar (câmeras geram arquivos de vários MB).
 *  Se o navegador não conseguir abrir o formato (HEIC no Chrome, por exemplo), manda a original. */
export async function compressImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    return blob ?? file;
  } catch {
    return file;
  }
}

const PhotoPicker = styled.label`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 180px;
  border: 2px dashed ${({ theme }) => theme.color.borderStrong};
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.background};
  color: ${({ theme }) => theme.color.text};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  cursor: pointer;
  overflow: hidden;
  text-align: center;

  input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  img { max-width: 100%; max-height: 320px; display: block; }
  &:focus-within { outline: 2px solid ${({ theme }) => theme.color.primary}; outline-offset: 2px; }
`;

const TextArea = styled.textarea`
  min-height: 72px;
  padding: 10px 12px;
  border: 1px solid ${({ theme }) => theme.color.borderStrong};
  border-radius: ${({ theme }) => theme.radius};
  font: inherit;
  font-size: ${({ theme }) => theme.font.size.md};
  resize: vertical;
`;

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

interface ProofDialogProps {
  delivery: Delivery | null;
  outcome: 'delivered' | 'failed';
  /** Onde o motorista está (vai junto no comprovante) */
  position: LatLng | null;
  onClose: () => void;
  /** Ficou guardado no celular (sem sinal): vai sozinho quando o sinal voltar */
  onQueued?: () => void;
}

/** No endereço: foto da entrega feita (canhoto, mercadoria) ou do motivo de o cliente não ter recebido. */
export function ProofDialog({ delivery, outcome, position, onClose, onQueued }: ProofDialogProps) {
  const register = useRegisterOutcome();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reason, setReason] = useState<FailureReason | ''>('');
  const [note, setNote] = useState('');
  const [receiver, setReceiver] = useState('');
  const [receiverDoc, setReceiverDoc] = useState('');
  const [preparing, setPreparing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const signature = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    setFile(null);
    setReason('');
    setNote('');
    setReceiver('');
    setReceiverDoc('');
    register.reset();
  }, [delivery?.id, outcome]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!delivery || !file) return;
    setPreparing(true);
    const photo = await compressImage(file);
    const signed = outcome === 'delivered' ? await signature.current?.toBlob() : null;
    setPreparing(false);
    register.mutate(
      {
        deliveryId: delivery.id,
        customerName: delivery.customer_name,
        outcome,
        photo,
        signature: signed,
        receiver_name: outcome === 'delivered' ? receiver.trim() : undefined,
        receiver_document: outcome === 'delivered' ? receiverDoc.trim() || undefined : undefined,
        reason: outcome === 'failed' ? (reason as FailureReason) : undefined,
        note: note.trim() || undefined,
        latitude: position?.[0],
        longitude: position?.[1],
      },
      {
        onSuccess: (result) => {
          if (result.queued) onQueued?.();
          onClose();
        },
      },
    );
  }

  const delivered = outcome === 'delivered';
  const busy = preparing || register.isPending;
  return (
    <Dialog
      open={Boolean(delivery)}
      size="small"
      title={delivered ? 'Confirmar entrega' : 'Cliente não recebeu'}
      onClose={onClose}
    >
      {delivery && (
        <form onSubmit={onSubmit}>
          <Stack>
            <Muted>
              <strong>{delivery.customer_name}</strong> · {delivery.address}, {delivery.city}
              {delivery.invoice_number && ` · NF ${delivery.invoice_number}`}
            </Muted>
            <PhotoPicker>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                required
                aria-label={delivered ? 'Foto do canhoto ou da mercadoria entregue' : 'Foto do local'}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {preview ? (
                <img src={preview} alt="Foto escolhida" />
              ) : (
                <>
                  <Icon name="camera" size={32} />
                  {delivered ? 'Tirar foto do canhoto ou da mercadoria' : 'Tirar foto do local'}
                  <Muted style={{ fontSize: 12, fontWeight: 400 }}>Obrigatória: vale como comprovante para a base</Muted>
                </>
              )}
            </PhotoPicker>
            {preview && (
              <Button type="button" $variant="secondary" onClick={() => inputRef.current?.click()}>Trocar foto</Button>
            )}
            {delivered && (
              <>
                <FieldLabel>
                  Nome de quem recebeu *
                  <Input value={receiver} onChange={(e) => setReceiver(e.target.value)} maxLength={120} required autoComplete="off" />
                </FieldLabel>
                <FieldLabel>
                  Documento (RG ou CPF)
                  <Input value={receiverDoc} onChange={(e) => setReceiverDoc(e.target.value)} maxLength={20} placeholder="opcional" autoComplete="off" />
                </FieldLabel>
                <div>
                  <Muted style={{ fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Assinatura</Muted>
                  <SignaturePad ref={signature} label="Quadro para a assinatura de quem recebeu" />
                </div>
              </>
            )}
            {!delivered && (
              <FieldLabel>
                Motivo *
                <Select value={reason} onChange={(e) => setReason(e.target.value as FailureReason)} required>
                  <option value="">Selecione</option>
                  {(Object.keys(REASON_LABEL) as FailureReason[]).map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
                </Select>
              </FieldLabel>
            )}
            <FieldLabel>
              Observação
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder={delivered ? 'Quem recebeu, por exemplo' : 'O que aconteceu'}
              />
            </FieldLabel>
            {register.isError && <ErrorText role="alert">{errorMessage(register.error)}</ErrorText>}
            <FormActions>
              <Button type="button" $variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={!file || busy || (!delivered && !reason) || (delivered && receiver.trim().length < 2)}>
                {busy ? 'Enviando…' : delivered ? 'Confirmar entrega' : 'Enviar ocorrência'}
              </Button>
            </FormActions>
          </Stack>
        </form>
      )}
    </Dialog>
  );
}

const Photo = styled.img`
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: contain;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.background};
`;

const SignatureImage = styled.img`
  display: block;
  max-width: 320px;
  width: 100%;
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius};
  background: #fff;
`;

function Signature({ deliveryId, name }: { deliveryId: number; name: string | null }) {
  const image = useAuthImage(`/deliveries/${deliveryId}/proof/signature`);
  return image.data ? <SignatureImage src={image.data} alt={`Assinatura de ${name ?? 'quem recebeu'}`} /> : null;
}

/** Comprovante enviado pelo motorista: foto, quem recebeu (com a assinatura), hora, motivo e onde foi tirada. */
export function ProofView({ delivery, driverName, onClose }: { delivery: Delivery | null; driverName?: string; onClose: () => void }) {
  const proof = delivery?.proof;
  const photo = useProofPhoto(proof ? delivery!.id : null);
  return (
    <Dialog open={Boolean(delivery)} size="small" title={delivery ? delivery.customer_name : 'Comprovante'} onClose={onClose}>
      {delivery && proof && (
        <Stack>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {proof.outcome === 'delivered'
              ? <Pill $tone="success">Entregue</Pill>
              : <Pill $tone="danger">Não entregue · {REASON_LABEL[proof.reason ?? 'other']}</Pill>}
            <Muted style={{ fontSize: 12 }}>
              {fmtDate(localDateISO(proof.created_at))} às {fmtTime(proof.created_at)}{driverName ? ` · ${driverName}` : ''}
            </Muted>
          </div>
          {photo.isLoading && <Muted>Carregando a foto…</Muted>}
          {photo.isError && <ErrorText role="alert">{errorMessage(photo.error, 'Não consegui abrir a foto.')}</ErrorText>}
          {photo.data && <Photo src={photo.data} alt={`Foto do comprovante de ${delivery.customer_name}`} />}
          {proof.receiver_name && (
            <Muted>
              Recebido por <strong>{proof.receiver_name}</strong>{proof.receiver_document ? ` · documento ${proof.receiver_document}` : ''}
            </Muted>
          )}
          {proof.has_signature && <Signature deliveryId={delivery.id} name={proof.receiver_name} />}
          {proof.note && <Muted>“{proof.note}”</Muted>}
          <Muted style={{ fontSize: 12 }}>
            {delivery.address}, {delivery.city}
            {proof.latitude !== null && (
              <>
                {' · '}
                <a href={`https://www.google.com/maps?q=${proof.latitude},${proof.longitude}`} target="_blank" rel="noreferrer">
                  ver onde a foto foi tirada
                </a>
              </>
            )}
          </Muted>
        </Stack>
      )}
    </Dialog>
  );
}

const Thumb = styled.button`
  all: unset;
  box-sizing: border-box;
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  border-radius: ${({ theme }) => theme.radius};
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.background};
  color: ${({ theme }) => theme.color.textSoft};
  display: grid;
  place-items: center;
  overflow: hidden;
  cursor: pointer;

  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; outline-offset: 2px; }
`;

/** Miniatura da foto do comprovante. Só baixa a foto quando ela aparece na tela (listas longas). */
export function ProofThumb({ delivery, onOpen }: { delivery: Delivery; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const photo = useProofPhoto(visible && delivery.proof ? delivery.id : null);
  return (
    <Thumb ref={ref} type="button" onClick={onOpen} aria-label={`Ver a foto do comprovante de ${delivery.customer_name}`}>
      {photo.data ? <img src={photo.data} alt="" /> : <Icon name="camera" size={22} />}
    </Thumb>
  );
}
