import { useState } from 'react';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useAuthImage, useExpenses, useReviewExpense } from '../api/queries';
import type { Expense } from '../api/types';
import { fmtBRL, fmtDate, fmtTime } from '../format';
import { Dialog } from './Dialog';
import { Button, Card, CardTitle, ErrorText, FieldLabel, FormActions, Input, Muted, Pill } from './ui';

const List = styled.ul`
  list-style: none;
  margin: 8px 0 0;
  padding: 0;

  > li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${({ theme }) => theme.space(2)};
    padding: 12px 0;
    border-top: 1px solid ${({ theme }) => theme.color.border};
  }
  strong { color: ${({ theme }) => theme.color.textStrong}; }
  small { display: block; font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  ${Button} { height: 36px; padding: 0 12px; }
`;

const Thumb = styled.button`
  all: unset;
  cursor: pointer;
  width: 64px;
  height: 64px;
  border-radius: ${({ theme }) => theme.radius};
  border: 1px solid ${({ theme }) => theme.color.border};
  overflow: hidden;
  display: grid;
  place-items: center;
  background: ${({ theme }) => theme.color.background};
  img { width: 100%; height: 100%; object-fit: cover; }
`;

const Big = styled.img`
  display: block;
  width: 100%;
  max-height: 480px;
  object-fit: contain;
  border-radius: ${({ theme }) => theme.radius};
`;

function ExpensePhoto({ expense, onOpen }: { expense: Expense; onOpen: () => void }) {
  const image = useAuthImage(`/expenses/${expense.id}/photo`);
  return <Thumb type="button" onClick={onOpen} aria-label={`Ver o comprovante de ${expense.kind_label}`}>{image.data ? <img src={image.data} alt="" /> : '…'}</Thumb>;
}

function PhotoDialog({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const image = useAuthImage(expense ? `/expenses/${expense.id}/photo` : null);
  return (
    <Dialog open={Boolean(expense)} size="small" title={expense ? `${expense.kind_label} · ${fmtBRL(expense.amount)}` : 'Comprovante'} onClose={onClose}>
      {image.data && <Big src={image.data} alt="Foto do comprovante" />}
      {expense?.note && <Muted style={{ marginTop: 8 }}>“{expense.note}”</Muted>}
    </Dialog>
  );
}

const statusPill = (e: Expense) =>
  e.status === 'approved'
    ? <Pill $tone="success">Aprovada{e.payment_status === 'paid' ? ' · paga' : ' · a pagar'}</Pill>
    : e.status === 'rejected' ? <Pill $tone="danger">Recusada</Pill> : <Pill $tone="warning">Para aprovar</Pill>;

/** Gestor: despesas que os motoristas pagaram na rota, para aprovar (vira reembolso a pagar) ou recusar com o motivo. */
export function ExpenseReview({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const expenses = useExpenses(dateFrom, dateTo);
  const review = useReviewExpense();
  const [photo, setPhoto] = useState<Expense | null>(null);
  const [rejecting, setRejecting] = useState<Expense | null>(null);
  const [reason, setReason] = useState('');
  const all = expenses.data ?? [];
  const pending = all.filter((e) => e.status === 'pending');
  const reviewed = all.filter((e) => e.status !== 'pending');
  if (!all.length) return null;

  const row = (e: Expense) => (
    <li key={e.id}>
      <ExpensePhoto expense={e} onOpen={() => setPhoto(e)} />
      <div style={{ flex: 1, minWidth: 200 }}>
        <strong>{e.kind_label} · {fmtBRL(e.amount)}</strong>
        <small>
          {e.driver_name} · {fmtDate(e.spent_at.slice(0, 10))} às {fmtTime(e.spent_at)}{e.run_day ? ` · rota de ${fmtDate(e.run_day)}` : ''}
        </small>
        {e.note && <small>“{e.note}”</small>}
        {e.reject_reason && <small>Motivo da recusa: {e.reject_reason}</small>}
      </div>
      {e.status === 'pending' ? (
        <span style={{ display: 'flex', gap: 6 }}>
          <Button type="button" disabled={review.isPending} onClick={() => review.mutate({ id: e.id, approve: true })}>Aprovar</Button>
          <Button type="button" $variant="secondary" disabled={review.isPending} onClick={() => { setReason(''); setRejecting(e); }}>Recusar</Button>
        </span>
      ) : statusPill(e)}
    </li>
  );

  return (
    <Card aria-label="Despesas da rota">
      <CardTitle>Despesas para aprovar{pending.length ? ` (${pending.length})` : ''}</CardTitle>
      <Muted style={{ marginTop: 4, fontSize: 12 }}>Aprovada, a despesa vira um reembolso em “A pagar” para o motorista.</Muted>
      {pending.length === 0 && <Muted style={{ marginTop: 8 }}>Nenhuma despesa esperando análise.</Muted>}
      <List>{pending.map(row)}</List>
      {reviewed.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer' }}>Analisadas no período ({reviewed.length})</summary>
          <List>{reviewed.map(row)}</List>
        </details>
      )}
      {review.isError && <ErrorText role="alert">{errorMessage(review.error)}</ErrorText>}
      <PhotoDialog expense={photo} onClose={() => setPhoto(null)} />
      <Dialog open={Boolean(rejecting)} size="small" title="Recusar despesa" onClose={() => setRejecting(null)}>
        <form onSubmit={(ev) => { ev.preventDefault(); if (rejecting) review.mutate({ id: rejecting.id, approve: false, reason }, { onSuccess: () => setRejecting(null) }); }}>
          <FieldLabel>
            Motivo (o motorista vê) *
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required autoFocus placeholder="Ex.: comprovante ilegível" />
          </FieldLabel>
          <FormActions style={{ marginTop: 16 }}>
            <Button type="button" $variant="secondary" onClick={() => setRejecting(null)}>Cancelar</Button>
            <Button type="submit" disabled={reason.trim().length < 3 || review.isPending}>Recusar</Button>
          </FormActions>
        </form>
      </Dialog>
    </Card>
  );
}
