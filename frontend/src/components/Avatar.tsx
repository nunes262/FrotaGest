import styled from 'styled-components';
import { Icon } from './Icon';

const Circle = styled.span<{ $group?: boolean; $size: number }>`
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  flex-shrink: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: ${({ theme, $group }) => ($group ? theme.color.primary : theme.color.neutralTint)};
  color: ${({ theme, $group }) => ($group ? theme.color.textInvert : theme.color.textStrong)};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.bold};
`;

/** Primeira letra do primeiro e do último nome: "João Pereira" → "JP". */
const initials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

export function Avatar({ name, group = false, size = 40 }: { name: string; group?: boolean; size?: number }) {
  return (
    <Circle aria-hidden="true" $group={group} $size={size}>
      {group ? <Icon name="users" size={Math.round(size / 2)} /> : initials(name)}
    </Circle>
  );
}
