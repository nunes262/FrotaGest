import styled from 'styled-components';
import type { DeliveriesAssigned } from '../api/types';
import { fmtDayRelative, fmtKg, plural } from '../format';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { Button, FormActions } from './ui';

const Message = styled.div`
  display: flex;
  align-items: flex-start;
  gap: ${({ theme }) => theme.space(2)};
  margin-bottom: ${({ theme }) => theme.space(3)};

  p { margin: 0; font-size: ${({ theme }) => theme.font.size.lg}; line-height: 1.5; }
  strong { color: ${({ theme }) => theme.color.textStrong}; }
`;

const Badge = styled.span`
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: ${({ theme }) => theme.color.primaryTint};
  color: ${({ theme }) => theme.color.primary};
  display: grid;
  place-items: center;
`;

interface Props {
  notice: DeliveriesAssigned | null;
  onView: (notice: DeliveriesAssigned) => void;
  onClose: () => void;
}

/** Aviso ao motorista de que o gestor colocou entregas no caminhão dele. */
export function LoadReceivedDialog({ notice, onView, onClose }: Props) {
  return (
    <Dialog open={Boolean(notice)} title="Você recebeu um carregamento" size="small" onClose={onClose}>
      {notice && (
        <>
          <Message>
            <Badge aria-hidden="true"><Icon name="box" size={28} /></Badge>
            <p>
              {notice.assigned_by} colocou <strong>{plural(notice.count, 'entrega', 'entregas')}</strong> no seu
              caminhão para <strong>{fmtDayRelative(notice.day)}</strong>, com {fmtKg(notice.weight_kg)} no total.
            </p>
          </Message>
          <FormActions>
            <Button type="button" $variant="secondary" onClick={onClose}>Continuar aqui</Button>
            <Button type="button" onClick={() => onView(notice)}>Ver carregamento</Button>
          </FormActions>
        </>
      )}
    </Dialog>
  );
}
