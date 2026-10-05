import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { useRegionTable, useResetRegionTable, useSaveRegionTable } from '../api/queries';
import type { RouteRegion } from '../api/types';
import { fmtBRL } from '../format';
import { Icon } from './Icon';
import { Button, Card, CardTitle, ErrorText, IconButton, Input, Muted, SuccessText, Table, TableScroll } from './ui';

const Rows = styled(Table)`
  td { vertical-align: top; }
  ${Input} { width: 100%; min-width: 0; }
  textarea {
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid ${({ theme }) => theme.color.borderStrong};
    border-radius: ${({ theme }) => theme.radius};
    font: inherit;
    font-size: ${({ theme }) => theme.font.size.md};
    resize: vertical;
  }
  small { display: block; margin-top: 4px; font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space(1)};
`;

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const Caution = styled.p`
  margin: 0;
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.color.cautionTint};
  color: ${({ theme }) => theme.color.cautionInk};
  font-size: ${({ theme }) => theme.font.size.md};
`;

interface Draft {
  key: string;
  name: string;
  price: string;
  maxKm: string;
  cities: string;
}

const toDraft = (r: RouteRegion): Draft => ({
  key: String(r.id),
  name: r.name,
  price: String(r.price),
  maxKm: r.max_km === null ? '' : String(r.max_km),
  cities: r.cities.join(', '),
});

const rangeText = (r: Pick<RouteRegion, 'max_km'>) => (r.max_km === null ? 'sem limite' : `até ${r.max_km.toLocaleString('pt-BR')} km da base`);

/** Gestor: tabela de preço fixo da rota por região, editável. */
export function RegionTableEditor() {
  const table = useRegionTable();
  const save = useSaveRegionTable();
  const reset = useResetRegionTable();
  const [rows, setRows] = useState<Draft[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!table.data) return;
    setRows(table.data.regions.map(toDraft));
  }, [table.data]);

  const change = (key: string, patch: Partial<Draft>) => {
    setSaved(false);
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(
      {
        regions: rows.map((r) => ({
          name: r.name.trim(),
          price: Number(r.price.replace(',', '.')),
          max_km: r.maxKm.trim() ? Number(r.maxKm.replace(',', '.')) : null,
          cities: r.cities.split(/[,;\n]/).map((c) => c.trim()).filter(Boolean),
        })),
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  function onReset() {
    if (window.confirm('Voltar para a tabela sugerida? As regiões e os preços que você mudou serão trocados.')) {
      reset.mutate(undefined, { onSuccess: () => setSaved(true) });
    }
  }

  const busy = save.isPending || reset.isPending;
  return (
    <Card aria-label="Preço por região">
      <form onSubmit={onSubmit}>
        <Stack>
          <div>
            <CardTitle>Preço fixo da rota por região</CardTitle>
            <Muted style={{ marginTop: 4 }}>
              Cada rota vale um preço fixo, não importa quantas entregas leve (dentro da capacidade do veículo). A entrega cai na
              região que lista a cidade dela; se nenhuma lista, na primeira faixa de distância da base (em linha reta). A rota vale a
              região mais cara entre as entregas.
            </Muted>
          </div>
          {table.data && !table.data.has_base && (
            <Caution>
              A empresa ainda não tem base. <Link to="/configuracoes">Defina a base</Link> para as faixas de distância valerem; sem
              ela, só as cidades listadas encaixam a rota numa região.
            </Caution>
          )}
          {table.isLoading && <Muted>Carregando a tabela…</Muted>}
          {table.isError && <ErrorText role="alert">{errorMessage(table.error)}</ErrorText>}
          {rows.length > 0 && (
            <TableScroll>
              <Rows>
                <thead>
                  <tr>
                    <th style={{ width: '30%' }}>Região</th>
                    <th style={{ width: '14%' }}>Até (km da base)</th>
                    <th>Cidades que sempre entram nela</th>
                    <th style={{ width: '16%' }}>Preço da rota (R$)</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>
                        <Input aria-label="Nome da região" value={r.name} maxLength={80} required minLength={2} onChange={(e) => change(r.key, { name: e.target.value })} />
                      </td>
                      <td>
                        <Input aria-label={`Distância máxima de ${r.name}`} type="number" min={1} step="1" inputMode="numeric" value={r.maxKm} placeholder="sem limite" onChange={(e) => change(r.key, { maxKm: e.target.value })} />
                      </td>
                      <td>
                        <textarea aria-label={`Cidades de ${r.name}`} rows={1} value={r.cities} placeholder="opcional, separadas por vírgula" onChange={(e) => change(r.key, { cities: e.target.value })} />
                      </td>
                      <td>
                        <Input aria-label={`Preço de ${r.name}`} type="number" min={1} step="0.01" inputMode="decimal" value={r.price} required onChange={(e) => change(r.key, { price: e.target.value })} />
                        {Number(r.price) > 0 && <small>{fmtBRL(Number(r.price))} por rota</small>}
                      </td>
                      <td>
                        <IconButton type="button" aria-label={`Tirar ${r.name}`} disabled={rows.length === 1} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
                          <Icon name="trash" size={20} />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Rows>
            </TableScroll>
          )}
          {rows.length > 0 && (
            <div>
              <Button type="button" $variant="secondary" disabled={rows.length >= 20} onClick={() => setRows((list) => [...list, { key: `new-${Date.now()}`, name: '', price: '', maxKm: '', cities: '' }])}>
                <Icon name="plus" size={18} />
                Adicionar região
              </Button>
            </div>
          )}
          <Muted style={{ fontSize: 12 }}>
            O preço da região entra sozinho em “A pagar” (e no “A receber” do motorista) quando ele encerra a rota.
          </Muted>
          <Muted style={{ fontSize: 12 }}>
            Sugestão para van (tipo Fiat Ducato), a partir de uma pesquisa de 2025–2026: a Shopee paga por faixa de km da rota (utilitário
            de R$ 234 a R$ 437), o Mercado Livre de R$ 200 a R$ 400 por rota de van e a Loggi de R$ 350 a R$ 700 a diária. Ajuste para a
            sua operação. Mudar a tabela vale para as próximas rotas; as já calculadas mantêm o preço.
          </Muted>
          {(save.isError || reset.isError) && <ErrorText role="alert">{errorMessage(save.error ?? reset.error)}</ErrorText>}
          {saved && <SuccessText role="status">Tabela salva. Vale para as próximas rotas.</SuccessText>}
          <Actions>
            <Button type="button" $variant="secondary" disabled={busy} onClick={onReset}>Restaurar sugestão</Button>
            <Button type="submit" disabled={busy || !rows.length}>{save.isPending ? 'Salvando…' : 'Salvar tabela'}</Button>
          </Actions>
        </Stack>
      </form>
    </Card>
  );
}

/** Tabela só para consulta (motorista). */
export function RegionTableView() {
  const table = useRegionTable();
  if (!table.data) return null;
  return (
    <Card aria-label="Preço por região">
      <CardTitle>Quanto vale cada rota</CardTitle>
      <Muted style={{ margin: '4px 0 8px' }}>Preço fixo por região, não importa quantas entregas. Vale a região mais distante da rota.</Muted>
      <TableScroll>
        <Rows style={{ minWidth: 0 }}>
          <tbody>
            {table.data.regions.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                  <small>{r.cities.length ? `${r.cities.slice(0, 4).join(', ')}${r.cities.length > 4 ? ` e mais ${r.cities.length - 4}` : ''} · ` : ''}{rangeText(r)}</small>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><strong>{fmtBRL(r.price)}</strong></td>
              </tr>
            ))}
          </tbody>
        </Rows>
      </TableScroll>
    </Card>
  );
}
