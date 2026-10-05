import styled, { css } from 'styled-components';

export const Card = styled.section`
  background: ${({ theme }) => theme.color.surface};
  border-radius: ${({ theme }) => theme.radius};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: ${({ theme }) => theme.space(3)};
  min-width: 0;
`;

export const CardTitle = styled.h2`
  font-size: ${({ theme }) => theme.font.size.lg};
  font-weight: ${({ theme }) => theme.font.weight.bold};
`;

export const Button = styled.button<{ $variant?: 'primary' | 'secondary' }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.space(1)};
  height: 44px;
  padding: 0 ${({ theme }) => theme.space(3)};
  border-radius: ${({ theme }) => theme.radius};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  cursor: pointer;
  transition: background 120ms ease;
  ${({ theme, $variant = 'primary' }) =>
    $variant === 'primary'
      ? css`
          border: 0;
          background: ${theme.color.primary};
          color: ${theme.color.textInvert};
          &:hover:not(:disabled) { background: ${theme.color.primaryHover}; }
          &:disabled { background: ${theme.color.disabled}; color: #fff; }
        `
      : css`
          border: 1.5px solid ${theme.color.primary};
          background: ${theme.color.surface};
          color: ${theme.color.primary};
          &:hover:not(:disabled) { background: ${theme.color.primaryTint}; }
          &:disabled { border-color: ${theme.color.border}; color: ${theme.color.disabled}; }
        `}
  &:disabled { cursor: not-allowed; }
`;

type Tone = 'success' | 'caution' | 'danger' | 'neutral' | 'warning';

export const Pill = styled.span<{ $tone: Tone }>`
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  white-space: nowrap;
  ${({ theme, $tone }) => {
    const map = {
      success: [theme.color.successTint, theme.color.successInk],
      caution: [theme.color.cautionTint, theme.color.cautionInk],
      warning: [theme.color.warningTint, theme.color.warningInk],
      danger: [theme.color.dangerTint, theme.color.dangerInk],
      neutral: [theme.color.neutralTint, theme.color.text],
    } as const;
    const [bg, fg] = map[$tone];
    return css`background: ${bg}; color: ${fg};`;
  }}
`;

export const FieldLabel = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textSoft};
`;

const control = css`
  height: 44px;
  min-width: 160px;
  border: 1px solid ${({ theme }) => theme.color.borderStrong};
  border-radius: ${({ theme }) => theme.radius};
  padding: 0 12px;
  font-size: ${({ theme }) => theme.font.size.md};
  color: ${({ theme }) => theme.color.text};
  background: ${({ theme }) => theme.color.surface};

  &:disabled {
    border-color: ${({ theme }) => theme.color.border};
    background: ${({ theme }) => theme.color.background};
    color: ${({ theme }) => theme.color.textSoft};
    opacity: 1;
    cursor: not-allowed;
  }
`;

export const Input = styled.input`${control}`;
export const Select = styled.select`${control}`;

export const IconButton = styled.button`
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: ${({ theme }) => theme.radius};
  background: transparent;
  color: ${({ theme }) => theme.color.text};
  display: grid;
  place-items: center;
  cursor: pointer;
  &:hover:not(:disabled) { background: ${({ theme }) => theme.color.background}; }
  &:disabled { color: ${({ theme }) => theme.color.disabled}; cursor: not-allowed; }
`;

export const CountBadge = styled.span`
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  flex-shrink: 0;
  border-radius: 10px;
  background: ${({ theme }) => theme.color.primary};
  color: ${({ theme }) => theme.color.textInvert};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  display: inline-grid;
  place-items: center;
`;

/** Texto só para leitores de tela. */
export const SrOnly = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
`;

export const FormSection = styled.fieldset`
  border: 0;
  padding: 0;
  margin: 0 0 ${({ theme }) => theme.space(3)};
  min-width: 0;

  legend {
    padding: 0;
    margin-bottom: ${({ theme }) => theme.space(2)};
    font-size: ${({ theme }) => theme.font.size.lg};
    font-weight: ${({ theme }) => theme.font.weight.bold};
    color: ${({ theme }) => theme.color.textStrong};
  }
`;

export const FormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: ${({ theme }) => theme.space(2)};
  ${Input}, ${Select} { width: 100%; min-width: 0; }
`;

export const FormActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.space(1)};
`;

export const PageHeader = styled.header`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: ${({ theme }) => theme.space(2)};
  margin-bottom: ${({ theme }) => theme.space(3)};

  h1 { font-size: ${({ theme }) => theme.font.size.h2}; flex-grow: 1; }
`;

export const Muted = styled.p`
  margin: 0;
  font-size: ${({ theme }) => theme.font.size.md};
  color: ${({ theme }) => theme.color.textSoft};
`;

export const ErrorText = styled.p`
  margin: 0;
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.dangerTint};
  color: ${({ theme }) => theme.color.dangerInk};
  font-size: ${({ theme }) => theme.font.size.md};
`;

export const SuccessText = styled.p`
  margin: 0;
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.successTint};
  color: ${({ theme }) => theme.color.successInk};
  font-size: ${({ theme }) => theme.font.size.md};
`;

export const Table = styled.table`
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: ${({ theme }) => theme.font.size.md};

  th {
    text-align: left;
    font-size: ${({ theme }) => theme.font.size.sm};
    font-weight: ${({ theme }) => theme.font.weight.semibold};
    color: ${({ theme }) => theme.color.textSoft};
    padding: 12px 8px;
    border-bottom: 1px solid ${({ theme }) => theme.color.border};
  }
  td { padding: 12px 8px; border-bottom: 1px solid ${({ theme }) => theme.color.border}; }
  tbody tr:last-child td { border-bottom: 0; }
`;

export const TableScroll = styled.div`overflow-x: auto;`;
