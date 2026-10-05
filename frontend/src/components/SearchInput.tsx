import type { InputHTMLAttributes } from 'react';
import styled from 'styled-components';
import { Icon } from './Icon';
import { Input } from './ui';

const Wrap = styled.div`
  position: relative;

  svg {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: ${({ theme }) => theme.color.textSoft};
    pointer-events: none;
  }
  ${Input} { width: 100%; min-width: 0; padding-left: 40px; }
`;

export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Wrap>
      <Icon name="search" size={20} />
      <Input type="search" autoComplete="off" {...props} />
    </Wrap>
  );
}
