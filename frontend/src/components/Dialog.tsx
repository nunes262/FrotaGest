import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { Icon } from './Icon';
import { IconButton } from './ui';

const slideUp = keyframes`
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
`;

const Box = styled.dialog<{ $size: 'default' | 'small'; $sheet: boolean }>`
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

  /* Folha que sobe da borda de baixo (menu do celular) */
  ${({ $sheet }) =>
    $sheet &&
    css`
      width: 100%;
      max-width: 100%;
      max-height: 85dvh;
      margin: auto 0 0;
      border-radius: 16px 16px 0 0;
      &[open] { animation: ${slideUp} 200ms ease-out; }
    `}
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

const Body = styled.div<{ $sheet: boolean }>`
  padding: ${({ theme }) => theme.space(3)};
  ${({ $sheet }) => $sheet && css`padding-bottom: calc(24px + env(safe-area-inset-bottom));`}
`;

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 'small' para avisos e confirmações curtas */
  size?: 'default' | 'small';
  /** 'sheet' sobe da borda de baixo e fecha ao tocar fora (menu do celular) */
  placement?: 'center' | 'sheet';
}

/** Janela modal com o <dialog> nativo: prende o foco e fecha com Esc. O conteúdo só existe enquanto está aberta. */
export function Dialog({ open, title, onClose, children, size = 'default', placement = 'center' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const sheet = placement === 'sheet';
  // O conteúdo cobre a folha inteira: clique que chega no próprio <dialog> foi no fundo escuro
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (sheet && e.target === e.currentTarget) onClose();
  };

  return (
    <Box ref={ref} $size={size} $sheet={sheet} aria-labelledby={titleId} onClose={onClose} onClick={onBackdrop}>
      {open && (
        <>
          <Header>
            <h2 id={titleId}>{title}</h2>
            <IconButton type="button" aria-label="Fechar" onClick={onClose}>
              <Icon name="close" />
            </IconButton>
          </Header>
          <Body $sheet={sheet}>{children}</Body>
        </>
      )}
    </Box>
  );
}
