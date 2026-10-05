import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import styled from 'styled-components';
import { errorMessage } from '../api/client';
import { Link } from 'react-router-dom';
import { useCompanyBase, useGeocode, useRegionTable, useSaveCompanyBase } from '../api/queries';
import type { CompanyBase } from '../api/types';
import { CityInput, StreetInput, type CityValue } from '../components/AddressInputs';
import { FleetMap } from '../components/FleetMap';
import { Icon } from '../components/Icon';
import { TrackersCard } from '../components/TrackersCard';
import { AppSetupCard } from '../components/AppSetup';
import { fmtBRL } from '../format';
import {
  Button,
  Card,
  CardTitle,
  ErrorText,
  FieldLabel,
  FormActions,
  FormGrid,
  Input,
  Muted,
  PageHeader,
  Select,
  SuccessText,
} from '../components/ui';

const RADII = [100, 300, 500, 1000, 2000];

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space(2)};
`;

const AddressRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: ${({ theme }) => theme.space(1)};
  ${FieldLabel} { flex: 1 1 220px; }
  ${FieldLabel}:nth-child(2) { flex: 2 1 320px; }
  ${Input} { width: 100%; }
`;

const Results = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius};

  li + li { border-top: 1px solid ${({ theme }) => theme.color.border}; }
  button {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    padding: 10px 12px;
    cursor: pointer;
    font-size: ${({ theme }) => theme.font.size.md};
    &:hover { background: ${({ theme }) => theme.color.background}; }
    &:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; outline-offset: -2px; }
  }
`;

const fmtRadius = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString('pt-BR')} km`);

interface Draft {
  name: string;
  street: string;
  city: CityValue;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
}

const emptyDraft: Draft = { name: 'CD', street: '', city: { name: '', uf: null }, latitude: null, longitude: null, radius_m: 300 };

/** "Rua X, 10 - Contagem/MG" ou "Contagem - MG" → rua e cidade. Em outro formato, tudo fica na rua. */
function parseAddress(address: string | null): Pick<Draft, 'street' | 'city'> {
  const m = address?.match(/^(?:(.+)\s-\s)?([^-/,]+?)\s*[/-]\s*([A-Z]{2})$/);
  if (!m) return { street: address ?? '', city: { name: '', uf: null } };
  return { street: m[1]?.trim() ?? '', city: { name: m[2].trim(), uf: m[3] } };
}

function formatAddress({ street, city }: Pick<Draft, 'street' | 'city'>): string {
  const place = [city.name.trim(), city.uf].filter(Boolean).join('/');
  return [street.trim().replace(/,$/, ''), place].filter(Boolean).join(' - ');
}

/** Atalho para a tabela de preço fixo da rota por região (a edição fica em Pagamentos). */
function RegionPricesCard() {
  const table = useRegionTable();
  const regions = table.data?.regions ?? [];
  return (
    <Card aria-labelledby="regions-title">
      <CardTitle id="regions-title">Preço das rotas por região</CardTitle>
      <Muted style={{ margin: '4px 0 12px' }}>
        Cada rota vale um preço fixo pela região que atende, não importa quantas entregas leve.
        {regions.length > 0 && ` Hoje: ${regions.map((r) => `${r.name} ${fmtBRL(r.price)}`).join(' · ')}.`}
      </Muted>
      <Link to="/pagamentos?aba=regioes">Editar os preços por região</Link>
    </Card>
  );
}

export function SettingsPage() {
  const base = useCompanyBase();
  const save = useSaveCompanyBase();
  const geocode = useGeocode();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fitTo, setFitTo] = useState<[number, number] | null>(null);

  // Começa com a base salva (ou em branco) assim que ela carrega
  useEffect(() => {
    if (!base.isSuccess || draft) return;
    const saved = base.data;
    setDraft(saved ? { ...saved, ...parseAddress(saved.address) } : emptyDraft);
    if (saved) setFitTo([saved.latitude, saved.longitude]);
  }, [base.isSuccess, base.data, draft]);

  if (!draft) return <Muted>Carregando…</Muted>;

  const set = (patch: Partial<Draft>) => {
    save.reset();
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };
  const hasPoint = draft.latitude !== null && draft.longitude !== null;
  const preview: CompanyBase | null = hasPoint
    ? { name: draft.name || 'Base', address: formatAddress(draft) || null, latitude: draft.latitude!, longitude: draft.longitude!, radius_m: draft.radius_m }
    : null;
  // Endereço para o mapa: "Rua X, 10, Contagem, MG"
  const searchText = [draft.street.trim().replace(/,$/, ''), draft.city.name.trim(), draft.city.uf].filter(Boolean).join(', ');

  function search() {
    if (searchText.length >= 3) geocode.mutate(searchText);
  }

  function onAddressKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      search();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!preview) return;
    save.mutate({ ...preview, name: draft!.name.trim() });
  }

  return (
    <>
      <PageHeader>
        <div style={{ flexGrow: 1 }}>
          <h1>Configurações</h1>
          <Muted>Dados da empresa usados no rastreamento.</Muted>
        </div>
      </PageHeader>

      <Card as="form" onSubmit={onSubmit} aria-labelledby="base-title">
        <Stack>
          <div>
            <CardTitle id="base-title">Base da empresa (CD)</CardTitle>
            <Muted style={{ marginTop: 4 }}>
              É de onde os caminhões saem. As rotas são divididas em viagens: cada viagem começa quando o caminhão sai do raio
              da base e termina quando volta. Dentro do raio, o caminhão aparece como “Na base”.
            </Muted>
          </div>

          <FormGrid>
            <FieldLabel>
              Nome da base *
              <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="CD Contagem" required minLength={2} />
            </FieldLabel>
            <FieldLabel>
              Raio da base
              <Select value={draft.radius_m} onChange={(e) => set({ radius_m: Number(e.target.value) })}>
                {RADII.map((r) => <option key={r} value={r}>{fmtRadius(r)}</option>)}
              </Select>
            </FieldLabel>
          </FormGrid>

          <AddressRow>
            <FieldLabel>
              Cidade
              <CityInput value={draft.city} onChange={(city) => set({ city })} onKeyDown={onAddressKey} placeholder="Comece a digitar" />
            </FieldLabel>
            <FieldLabel>
              Endereço
              <StreetInput
                value={draft.street}
                onChange={(street) => set({ street })}
                city={draft.city}
                onCityChange={(city) => set({ city })}
                onKeyDown={onAddressKey}
                placeholder="Rua e número, ou CEP"
              />
            </FieldLabel>
            <Button type="button" $variant="secondary" onClick={search} disabled={searchText.length < 3 || geocode.isPending}>
              <Icon name="search" size={20} />
              {geocode.isPending ? 'Buscando…' : 'Buscar no mapa'}
            </Button>
          </AddressRow>

          {geocode.isError && <ErrorText role="alert">{errorMessage(geocode.error)}</ErrorText>}
          {geocode.isSuccess && geocode.data.length === 0 && (
            <Muted role="status">Endereço não encontrado. Clique no mapa para marcar o ponto.</Muted>
          )}
          {geocode.isSuccess && geocode.data.length > 0 && (
            <Results aria-label="Endereços encontrados">
              {geocode.data.map((r) => (
                <li key={`${r.latitude},${r.longitude}`}>
                  <button
                    type="button"
                    onClick={() => {
                      set({ latitude: r.latitude, longitude: r.longitude });
                      setFitTo([r.latitude, r.longitude]);
                      geocode.reset();
                    }}
                  >
                    {r.label}
                  </button>
                </li>
              ))}
            </Results>
          )}

          <Muted>
            {hasPoint
              ? `Ponto marcado: ${draft.latitude!.toFixed(5)}, ${draft.longitude!.toFixed(5)}. Clique no mapa para ajustar.`
              : 'Busque o endereço ou clique no mapa para marcar onde fica a base.'}
          </Muted>
          <FleetMap base={preview} fitTo={fitTo} onPick={(latitude, longitude) => set({ latitude, longitude })} />

          {save.isSuccess && <SuccessText role="status">Base salva. Os mapas e as rotas já usam o novo ponto.</SuccessText>}
          {save.isError && <ErrorText role="alert">{errorMessage(save.error)}</ErrorText>}
          <FormActions>
            <Button type="submit" disabled={!hasPoint || !draft.name.trim() || save.isPending}>
              {save.isPending ? 'Salvando…' : 'Salvar base'}
            </Button>
          </FormActions>
        </Stack>
      </Card>

      <div style={{ marginTop: 16 }}>
        <RegionPricesCard />
      </div>

      <div style={{ marginTop: 16 }}>
        <TrackersCard />
      </div>

      <div style={{ marginTop: 16 }}>
        <AppSetupCard alwaysShow text="Receba neste aparelho as despesas para aprovar, as entregas feitas e as pendências de checklist, mesmo com o app fechado." />
      </div>
    </>
  );
}
