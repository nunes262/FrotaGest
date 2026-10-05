import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, ErrorText, FieldLabel, Input, Muted } from '../components/ui';
import { fmtCpf } from '../format';

const Page = styled.div`
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: ${({ theme }) => theme.space(3)};
`;

const Panel = styled.form`
  width: 100%;
  max-width: 400px;
  background: ${({ theme }) => theme.color.surface};
  border-radius: ${({ theme }) => theme.radius};
  box-shadow: ${({ theme }) => theme.shadow.card};
  padding: ${({ theme }) => theme.space(5)};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(3)};

  h1 { font-size: ${({ theme }) => theme.font.size.h1}; line-height: 1.1; }
  ${Input} { width: 100%; }
  ${Button} { width: 100%; height: 52px; font-size: ${({ theme }) => theme.font.size.lg}; }
`;

const Mark = styled.div`
  width: 56px;
  height: 56px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.primary};
  color: ${({ theme }) => theme.color.textInvert};
  display: grid;
  place-items: center;
  font-weight: ${({ theme }) => theme.font.weight.bold};
  font-size: ${({ theme }) => theme.font.size.xl};
`;

const Segmented = styled.div`
  position: relative;
  display: flex;
  padding: 4px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.background};
`;

// Destaque branco que desliza até a opção ativa
const SegmentThumb = styled.span<{ $index: number }>`
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc(50% - 4px);
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.surface};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  transform: translateX(${({ $index }) => $index * 100}%);
  transition: transform 250ms ease;
`;

const Segment = styled.button<{ $active: boolean }>`
  position: relative;
  flex: 1;
  height: 44px;
  border: 0;
  border-radius: ${({ theme }) => theme.radius};
  cursor: pointer;
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  background: transparent;
  color: ${({ theme, $active }) => ($active ? theme.color.primary : theme.color.textSoft)};
  transition: color 250ms ease;
`;

type Mode = 'admin' | 'driver';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('admin');
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Gestor e motorista usam credenciais diferentes: limpa o formulário ao trocar
  function changeMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setLoginValue('');
    setPassword('');
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(loginValue, password);
      const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
      navigate(from ?? (user.role === 'admin' ? '/' : '/minha-rota'), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page>
      <Panel onSubmit={onSubmit} noValidate>
        <Mark>FG</Mark>
        <div>
          <h1>Entrar no FrotaGest</h1>
          <Muted style={{ marginTop: 8 }}>Use a conta criada pela sua transportadora.</Muted>
        </div>
        <Segmented role="group" aria-label="Tipo de acesso">
          <SegmentThumb $index={mode === 'admin' ? 0 : 1} aria-hidden />
          <Segment type="button" $active={mode === 'admin'} aria-pressed={mode === 'admin'} onClick={() => changeMode('admin')}>
            Gestor
          </Segment>
          <Segment type="button" $active={mode === 'driver'} aria-pressed={mode === 'driver'} onClick={() => changeMode('driver')}>
            Motorista
          </Segment>
        </Segmented>
        <FieldLabel>
          {mode === 'admin' ? 'E-mail' : 'CPF'}
          <Input
            value={loginValue}
            onChange={(e) => setLoginValue(mode === 'driver' ? fmtCpf(e.target.value) : e.target.value)}
            type={mode === 'admin' ? 'email' : 'text'}
            inputMode={mode === 'admin' ? 'email' : 'numeric'}
            autoComplete="username"
            placeholder={mode === 'admin' ? 'voce@transportadora.com.br' : '000.000.000-00'}
            required
          />
        </FieldLabel>
        <FieldLabel>
          Senha
          <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
        </FieldLabel>
        {error && <ErrorText role="alert">{error}</ErrorText>}
        <Button type="submit" disabled={submitting || !loginValue || !password}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </Button>
      </Panel>
    </Page>
  );
}
