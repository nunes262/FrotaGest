import {
  useEffect,
  useId,
  useState,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import styled from 'styled-components';
import { Input } from './ui';

const Wrap = styled.div`
  position: relative;
  ${Input} { width: 100%; min-width: 0; }
`;

const Suffix = styled.span`
  position: absolute;
  right: 12px;
  top: 22px;
  transform: translateY(-50%);
  padding: 2px 6px;
  border-radius: 4px;
  background: ${({ theme }) => theme.color.neutralTint};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  pointer-events: none;
`;

const List = styled.ul`
  position: absolute;
  z-index: 10;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 280px;
  overflow-y: auto;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.surface};
  box-shadow: ${({ theme }) => theme.shadow.card};
`;

const Option = styled.li<{ $active: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  cursor: pointer;
  background: ${({ theme, $active }) => ($active ? theme.color.primaryTint : 'transparent')};
  color: ${({ theme }) => theme.color.text};

  &:hover { background: ${({ theme, $active }) => ($active ? theme.color.primaryTint : theme.color.background)}; }
  strong { font-size: ${({ theme }) => theme.font.size.md}; font-weight: ${({ theme }) => theme.font.weight.semibold}; color: ${({ theme }) => theme.color.textStrong}; }
  span { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const Message = styled.li`
  padding: 8px 12px;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textSoft};
`;

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'role'>;

interface Props<T> extends InputProps {
  value: string;
  onChange: (value: string) => void;
  /** O que está sendo buscado. Se não muda (ex.: digitando o número depois de escolher a rua), a lista não reabre. */
  term: string;
  options: T[];
  optionKey: (option: T) => string;
  renderOption: (option: T) => ReactNode;
  onPick: (option: T) => void;
  loading?: boolean;
  /** Aviso no lugar das opções ("Escolha a cidade primeiro", erro da busca…). */
  message?: string | null;
  /** Texto curto dentro do campo, à direita (ex.: a UF da cidade escolhida). */
  suffix?: string | null;
}

/** Campo de texto com sugestões enquanto digita (padrão combobox): setas escolhem, Enter confirma, Esc fecha.
 *  Continua aceitando texto livre. */
export function Autocomplete<T>({
  value,
  onChange,
  term,
  options,
  optionKey,
  renderOption,
  onPick,
  loading = false,
  message = null,
  suffix = null,
  onKeyDown,
  onFocus,
  onBlur,
  ...inputProps
}: Props<T>) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  // Termo para o qual a lista foi fechada (escolha feita ou Esc). Começa no valor inicial para não abrir sozinha.
  const [closedFor, setClosedFor] = useState<string | null>(term);
  const [picking, setPicking] = useState(false);

  // Depois de uma escolha o valor muda; a lista fica fechada até a pessoa voltar a digitar a busca
  useEffect(() => {
    if (!picking) return;
    setPicking(false);
    setClosedFor(term);
  }, [picking, term]);

  useEffect(() => setActive(-1), [options]);

  const hasContent = options.length > 0 || loading || Boolean(message);
  const open = focused && !picking && term !== closedFor && hasContent;

  function pick(option: T) {
    setPicking(true);
    onPick(option);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setClosedFor(null);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (options.length ? (i + step + options.length) % options.length : -1));
      return;
    }
    if (open && e.key === 'Enter') {
      // Com a lista aberta, Enter escolhe (ou só fecha) em vez de enviar o formulário
      e.preventDefault();
      if (active >= 0 && options[active]) pick(options[active]);
      else setClosedFor(term);
      return;
    }
    if (open && e.key === 'Escape') {
      // Fecha só a lista, não o modal em volta
      e.preventDefault();
      e.stopPropagation();
      setClosedFor(term);
      return;
    }
    onKeyDown?.(e);
  }

  return (
    <Wrap>
      <Input
        {...inputProps}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={(e: FocusEvent<HTMLInputElement>) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e: FocusEvent<HTMLInputElement>) => {
          setFocused(false);
          onBlur?.(e);
        }}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        style={suffix ? { paddingRight: 56 } : undefined}
      />
      {suffix && <Suffix aria-hidden="true">{suffix}</Suffix>}
      <List id={listId} role="listbox" hidden={!open}>
        {open && options.map((option, i) => (
          <Option
            key={optionKey(option)}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            $active={i === active}
            // mousedown em vez de click: o campo não perde o foco antes da escolha
            onMouseDown={(e) => {
              e.preventDefault();
              pick(option);
            }}
            onMouseEnter={() => setActive(i)}
          >
            {renderOption(option)}
          </Option>
        ))}
        {open && !options.length && <Message role="presentation">{loading ? 'Buscando…' : message}</Message>}
      </List>
    </Wrap>
  );
}
