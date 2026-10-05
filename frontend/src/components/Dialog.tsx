import { useEffect, useId, useRef, type ReactNode } from 'react';
import styled from 'styled-components';
import { Icon } from './Icon';
import { IconButton } from './ui';

const Box = styled.dialog<{ $size: 'default' | 'small' }>`
  width: min(${({ $size }) => ($size === 'small' ? 480 : 760)}px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  padding: 0;
  border: 0;
  border-radius: ${({ theme }) => theme.radius};
  box-shadow: ${({ theme }) => theme.shadow.card};
  background: ${({ theme }) => theme.color.surface};
  color: inherit;
  overflow: auto;

  &::backdrop { background: rgba(0, 0, 0, 0.4); }
`;

const Header = styled.header`
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space(2)};
  padding: ${({ theme }) => `${theme.space(2)} ${theme.space(3)}`};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.surface};

  h2 { font-size: ${({ theme }) => theme.font.size.xl}; }
`;

const Body = styled.div`
  padding: ${({ theme }) => theme.space(3)};
`;

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 'small' para avisos e confirmações curtas */
  size?: 'default' | 'small';
}

/** Janela modal com o <dialog> nativo: prende o foco e fecha com Esc. O conteúdo só existe enquanto está aberta. */
export function Dialog({ open, title, onClose, children, size = 'default' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <Box ref={ref} $size={size} aria-labelledby={titleId} onClose={onClose}>
      {open && (
        <>
          <Header>
            <h2 id={titleId}>{title}</h2>
            <IconButton type="button" aria-label="Fechar" onClick={onClose}>
              <Icon name="close" />
            </IconButton>
          </Header>
          <Body>{children}</Body>
        </>
      )}
    </Box>
  );
}
