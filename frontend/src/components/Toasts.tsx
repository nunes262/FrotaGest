import styled from 'styled-components';
import { Icon } from './Icon';
import { IconButton } from './ui';

export interface Toast {
  id: number;
  tone: 'success' | 'danger';
  title: string;
  text: string;
  /** Tela aberta ao tocar no aviso */
  to?: string;
}

const Stack = styled.div`
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2000;
  width: min(380px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Item = styled.div<{ $tone: Toast['tone'] }>`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 8px 12px 16px;
  border-radius: ${({ theme }) => theme.radius};
  border-left: 4px solid ${({ theme, $tone }) => ($tone === 'success' ? theme.color.success : theme.color.danger)};
  background: ${({ theme }) => theme.color.surface};
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);

  button.fg-toast-body {
    all: unset;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
  strong { display: block; color: ${({ theme }) => theme.color.textStrong}; }
  span { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  ${IconButton} { width: 32px; height: 32px; }
`;

/** Avisos rápidos no canto da tela (somem sozinhos). */
export function Toasts({ toasts, onOpen, onDismiss }: { toasts: Toast[]; onOpen: (toast: Toast) => void; onDismiss: (id: number) => void }) {
  return (
    <Stack role="status" aria-live="polite">
      {toasts.map((t) => (
        <Item key={t.id} $tone={t.tone}>
          <button type="button" className="fg-toast-body" onClick={() => { onDismiss(t.id); onOpen(t); }}>
            <strong>{t.title}</strong>
            <span>{t.text}</span>
          </button>
          <IconButton type="button" aria-label="Fechar aviso" onClick={() => onDismiss(t.id)}>
            <Icon name="close" size={16} />
          </IconButton>
        </Item>
      ))}
    </Stack>
  );
}
