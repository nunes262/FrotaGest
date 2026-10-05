import type { InputHTMLAttributes } from 'react';
import { errorMessage } from '../api/client';
import { useCitySuggestions, useStreetSuggestions } from '../api/queries';
import type { CitySuggestion, StreetSuggestion } from '../api/types';
import { onlyDigits, searchKey } from '../format';
import { useDebounced } from '../useDebounced';
import { Autocomplete } from './Autocomplete';

const DEBOUNCE_MS = 300;
const CEP_RE = /^\d{5}-?\d{3}$/;
const NONE: never[] = [];
// Tipos de via que o backend tira da busca ("Av Amazonas" → "amazonas")
const STREET_TYPE_WORDS = new Set(['r', 'rua', 'av', 'avenida', 'al', 'alameda', 'tv', 'trav', 'travessa', 'pc', 'pca', 'praca', 'rod', 'rodovia', 'est', 'estrada']);

/** Mesma normalização do backend: sem acento, minúsculo, só letras e números. */
const placeKey = (value: string) => searchKey(value).replace(/[^a-z0-9]+/g, ' ').trim();

// A lista anterior fica na tela enquanto a busca nova não chega. Só continua o que ainda bate com o texto,
// para ninguém escolher uma sugestão de outra busca.
const cityMatches = (c: CitySuggestion, term: string) => placeKey(c.name).includes(placeKey(term));

function streetMatches(s: StreetSuggestion, term: string) {
  if (CEP_RE.test(term)) return onlyDigits(s.cep) === onlyDigits(term);
  const words = placeKey(term).split(' ').filter(Boolean);
  while (words.length && /^\d+$/.test(words[words.length - 1])) words.pop();
  if (STREET_TYPE_WORDS.has(words[0])) words.shift();
  const street = placeKey(s.street);
  return words.every((w) => street.includes(w));
}

export interface CityValue {
  name: string;
  /** Conhecida quando a cidade foi escolhida na lista (há cidades com o mesmo nome em UFs diferentes). */
  uf: string | null;
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'role'>;

interface CityProps extends InputProps {
  value: CityValue;
  onChange: (value: CityValue) => void;
}

/** Cidade com sugestões da lista de municípios do IBGE. */
export function CityInput({ value, onChange, onBlur, ...inputProps }: CityProps) {
  const term = value.name.trim();
  const q = useDebounced(term, DEBOUNCE_MS);
  const cities = useCitySuggestions(q);
  const options = term.length >= 2 && cities.data ? cities.data.filter((c) => cityMatches(c, term)) : NONE;

  return (
    <Autocomplete<CitySuggestion>
      {...inputProps}
      value={value.name}
      onChange={(name) => onChange({ name, uf: null })}
      term={term}
      options={options}
      optionKey={(c) => `${c.name}/${c.uf}`}
      renderOption={(c) => <strong>{c.name} – {c.uf}</strong>}
      onPick={(c) => onChange({ name: c.name, uf: c.uf })}
      loading={(cities.isFetching || term !== q) && term.length >= 2 && !options.length}
      message={cities.isError ? errorMessage(cities.error) : term.length >= 2 && cities.isSuccess ? 'Nenhuma cidade com esse nome.' : null}
      suffix={value.uf}
      onBlur={(e) => {
        // Digitou o nome inteiro sem escolher: se só existe uma cidade com esse nome, fica com ela
        const same = options.filter((c) => searchKey(c.name) === searchKey(term));
        if (!value.uf && same.length === 1) onChange({ name: same[0].name, uf: same[0].uf });
        onBlur?.(e);
      }}
    />
  );
}

/** Parte da rua que vai para a busca: sem o número ("Rua Diamantina, 455" → "Rua Diamantina"). */
const streetTerm = (value: string) => value.split(',')[0].trim();

interface StreetProps extends InputProps {
  value: string;
  onChange: (value: string) => void;
  city: CityValue;
  /** Ao escolher um CEP de outra cidade, ou antes de escolher a cidade, ela é preenchida junto. */
  onCityChange: (value: CityValue) => void;
}

/** Rua com sugestões do ViaCEP para a cidade escolhida. Também aceita um CEP no lugar do nome. */
export function StreetInput({ value, onChange, city, onCityChange, ...inputProps }: StreetProps) {
  const term = streetTerm(value);
  const q = useDebounced(term, DEBOUNCE_MS);
  const isCep = CEP_RE.test(q);
  const hasCity = Boolean(city.uf && city.name.trim().length >= 3);
  const canSearch = isCep || (q.length >= 3 && hasCity);
  const streets = useStreetSuggestions(q, city.name.trim(), city.uf, canSearch);
  const searchable = CEP_RE.test(term) || (term.length >= 3 && hasCity);
  const options = canSearch && searchable && streets.data ? streets.data.filter((s) => streetMatches(s, term)) : NONE;

  let message: string | null = null;
  if (streets.isError) message = errorMessage(streets.error);
  else if (!isCep && term.length >= 3 && !hasCity) message = 'Escolha a cidade na lista para ver as ruas, ou digite o CEP.';
  else if (canSearch && streets.isSuccess) message = isCep ? 'CEP não encontrado.' : 'Nenhuma rua com esse nome nesta cidade. Pode digitar normalmente.';

  function pick(s: StreetSuggestion) {
    if (s.city !== city.name || s.uf !== city.uf) onCityChange({ name: s.city, uf: s.uf });
    // O número vem depois da vírgula; CEP geral (cidade pequena) não tem rua para preencher
    onChange(s.street ? `${s.street}, ` : '');
  }

  return (
    <Autocomplete<StreetSuggestion>
      {...inputProps}
      value={value}
      onChange={onChange}
      term={term}
      options={options}
      optionKey={(s) => `${s.street}/${s.district}/${s.cep}`}
      renderOption={(s) => (
        <>
          <strong>{s.street || `${s.city} – ${s.uf} (CEP geral)`}</strong>
          <span>{[s.district, isCep && s.street && `${s.city} – ${s.uf}`, isCep && `CEP ${s.cep}`].filter(Boolean).join(' · ')}</span>
        </>
      )}
      onPick={pick}
      loading={(streets.isFetching || term !== q) && searchable && !options.length}
      message={message}
    />
  );
}
