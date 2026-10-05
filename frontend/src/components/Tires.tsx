import { useEffect, useState, type FormEvent } from 'react';
import styled, { css } from 'styled-components';
import { errorMessage } from '../api/client';
import { useCreateTire, useDeleteTire, useRetreadTire, useRotateTire, useTireEvents, useUpdateTire } from '../api/queries';
import type { AxleLayout, Tire, TireEvent, TirePosition, Vehicle } from '../api/types';
import { fmtBRL, fmtDate, fmtKm, localDateISO } from '../format';
import { Button, Card, CardTitle, ErrorText, FieldLabel, FormActions, FormGrid, Input, Muted, Pill, Select } from './ui';

export const TIRE_POSITIONS: { value: TirePosition; label: string; code: string }[] = [
  { value: 'E1E', label: 'Dianteiro esquerdo', code: 'DE' },
  { value: 'E1D', label: 'Dianteiro direito', code: 'DD' },
  { value: 'E2E', label: 'Traseiro esquerdo', code: 'TE' },
  { value: 'E2D', label: 'Traseiro direito', code: 'TD' },
  { value: 'E2EE', label: 'Traseiro esquerdo externo', code: 'TEE' },
  { value: 'E2EI', label: 'Traseiro esquerdo interno', code: 'TEI' },
  { value: 'E2DI', label: 'Traseiro direito interno', code: 'TDI' },
  { value: 'E2DE', label: 'Traseiro direito externo', code: 'TDE' },
  { value: 'E3EE', label: '3º eixo esquerdo externo', code: '3EE' },
  { value: 'E3EI', label: '3º eixo esquerdo interno', code: '3EI' },
  { value: 'E3DI', label: '3º eixo direito interno', code: '3DI' },
  { value: 'E3DE', label: '3º eixo direito externo', code: '3DE' },
  { value: 'ESTEPE', label: 'Estepe', code: 'EST' },
];

const positionOf = (p: TirePosition) => TIRE_POSITIONS.find((t) => t.value === p)!;

/** Posições que existem em cada rodado traseiro (van de rodado simples não tem pneu interno). */
const LAYOUT_POSITIONS: Record<AxleLayout, TirePosition[]> = {
  single: ['E1E', 'E1D', 'E2E', 'E2D', 'ESTEPE'],
  dual: ['E1E', 'E1D', 'E2EE', 'E2EI', 'E2DI', 'E2DE', 'E3EE', 'E3EI', 'E3DI', 'E3DE', 'ESTEPE'],
};
const layoutOf = (v: Vehicle): AxleLayout => v.axle_layout ?? 'dual';

// Mínimo legal de sulco (Resolução CONTRAN 913/2022): é o 0% da banda
const LEGAL_MIN_MM = 1.6;
const pctToMm = (pct: number, newMm: number) => LEGAL_MIN_MM + (pct / 100) * (newMm - LEGAL_MIN_MM);

/** Como o pneu estaria depois de rodar mais `km` (o estepe não gasta). */
function project(tire: Tire, km: number): Tire {
  if (!km || !tire.in_use) return tire;
  const estimated = Math.max(0, tire.estimated_pct - (km * 100) / tire.life_km);
  return {
    ...tire,
    estimated_pct: estimated,
    wear_pct: 100 - estimated,
    estimated_mm: tire.tread_new_mm ? pctToMm(estimated, tire.tread_new_mm) : null,
    remaining_km: Math.round((estimated / 100) * tire.life_km),
    km_to_rotation: Math.round((Math.max(0, estimated - 50) / 100) * tire.life_km),
    km_to_replacement: Math.round((Math.max(0, estimated - 25) / 100) * tire.life_km),
  };
}

const fmtMm = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm`;
export const tirePositionLabel = (p: TirePosition) => positionOf(p).label;
const tireCode = (p: TirePosition) => positionOf(p).code;

type Tone = 'success' | 'caution' | 'danger';

/** Faixas do desgaste: até 50% bom, de 50% a 75% hora do rodízio, acima de 75% trocar. */
export const tireTone = (wearPct: number): Tone => (wearPct <= 50 ? 'success' : wearPct <= 75 ? 'caution' : 'danger');
const toneLabel: Record<Tone, string> = { success: 'Bom', caution: 'Rodízio', danger: 'Trocar' };

/** 1,25% · 90% · e valores bem pequenos sem virar zero (o desgaste de poucos km: 0,0015%). */
export const fmtPct = (n: number) =>
  `${n.toLocaleString('pt-BR', n > 0 && n < 0.1 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 2 })}%`;

/** Desgaste do pneu com a faixa: "65% · Rodízio". */
export function TireToneBadge({ wear }: { wear: number }) {
  const tone = tireTone(wear);
  return <Pill $tone={tone}>{fmtPct(Math.round(wear))} · {toneLabel[tone]}</Pill>;
}

// ---------- diagrama ----------

const toneBox = {
  success: css`border: 2px solid ${({ theme }) => theme.color.success}; background: ${({ theme }) => theme.color.successTint}; color: ${({ theme }) => theme.color.successInk};`,
  caution: css`border: 2px solid ${({ theme }) => theme.color.caution}; background: ${({ theme }) => theme.color.cautionTint}; color: ${({ theme }) => theme.color.cautionInk};`,
  danger: css`border: 2px dashed ${({ theme }) => theme.color.danger}; background: ${({ theme }) => theme.color.dangerTint}; color: ${({ theme }) => theme.color.dangerInk};`,
  empty: css`border: 2px dashed ${({ theme }) => theme.color.border}; background: ${({ theme }) => theme.color.surface}; color: ${({ theme }) => theme.color.textSoft};`,
};

const Chassis = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.space(4)};
  padding: ${({ theme }) => theme.space(1)} 0 ${({ theme }) => theme.space(2)};

  &::before {
    content: '';
    position: absolute;
    top: 28px;
    bottom: 64px;
    left: 50%;
    width: 28px;
    transform: translateX(-50%);
    border-radius: 6px;
    background: ${({ theme }) => theme.color.neutralTint};
  }
  > small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
`;

const Axle = styled.div`
  position: relative;
  display: flex;
  justify-content: center;
  gap: 72px;
  > div { display: flex; gap: 6px; }
`;

const Box = styled.button<{ $tone: Tone | 'empty'; $selected: boolean; $wide?: boolean }>`
  width: ${({ $wide }) => ($wide ? 56 : 46)}px;
  height: 76px;
  border-radius: ${({ theme }) => theme.radius};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  font-family: inherit;
  ${({ $tone }) => toneBox[$tone]}
  ${({ $selected, theme }) => $selected && css`box-shadow: 0 0 0 3px ${theme.color.surface}, 0 0 0 5px ${theme.color.textStrong};`}

  strong { font-size: ${({ theme }) => theme.font.size.md}; font-weight: ${({ theme }) => theme.font.weight.bold}; }
  span { font-size: ${({ theme }) => theme.font.size.xs}; font-weight: ${({ theme }) => theme.font.weight.semibold}; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; outline-offset: 2px; }
`;

const Legend = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 16px;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textSoft};

  span { display: inline-flex; align-items: center; gap: 6px; }
  i { width: 14px; height: 14px; border-radius: 3px; }
  i.success { ${toneBox.success} border-width: 1.5px; }
  i.caution { ${toneBox.caution} border-width: 1.5px; }
  i.danger { ${toneBox.danger} border-width: 1.5px; }
`;

interface DiagramProps {
  tires: Tire[];
  layout: AxleLayout;
  selected: TirePosition;
  onSelect: (p: TirePosition) => void;
}

/** Vista de cima do veículo com o desgaste de cada pneu. */
function TireDiagram({ tires, layout, selected, onSelect }: DiagramProps) {
  const byPosition = new Map(tires.map((t) => [t.position, t]));
  const thirdAxle = layout === 'dual' && (tires.some((t) => t.position.startsWith('E3')) || selected.startsWith('E3'));
  const box = (p: TirePosition, wide = false) => {
    const tire = byPosition.get(p);
    const tone = tire ? tireTone(tire.wear_pct) : 'empty';
    const label = tirePositionLabel(p);
    return (
      <Box
        key={p}
        type="button"
        $tone={tone}
        $wide={wide}
        $selected={selected === p}
        aria-pressed={selected === p}
        aria-label={tire ? `${label}: ${fmtPct(Math.round(tire.wear_pct))} de desgaste, ${toneLabel[tireTone(tire.wear_pct)]}` : `${label}: sem pneu`}
        onClick={() => onSelect(p)}
      >
        <strong>{tire ? fmtPct(Math.round(tire.wear_pct)) : '+'}</strong>
        <span>{tireCode(p)}</span>
      </Box>
    );
  };

  return (
    <>
      <Chassis role="group" aria-label="Desgaste por posição">
        <small>Frente do veículo</small>
        <Axle><div>{box('E1E', true)}</div><div>{box('E1D', true)}</div></Axle>
        {layout === 'single' ? (
          <Axle style={{ marginTop: 56 }}><div>{box('E2E', true)}</div><div>{box('E2D', true)}</div></Axle>
        ) : (
          <Axle style={{ marginTop: 56 }}><div>{box('E2EE')}{box('E2EI')}</div><div>{box('E2DI')}{box('E2DE')}</div></Axle>
        )}
        {thirdAxle && <Axle><div>{box('E3EE')}{box('E3EI')}</div><div>{box('E3DI')}{box('E3DE')}</div></Axle>}
        <Axle style={{ marginTop: 8 }}>{box('ESTEPE', true)}</Axle>
      </Chassis>
      <Legend>
        <span><i className="success" /> Até 50%</span>
        <span><i className="caution" /> 50–75%: rodízio</span>
        <span><i className="danger" /> Acima de 75%: trocar</span>
      </Legend>
    </>
  );
}

// ---------- ficha do pneu ----------

const Facts = styled.dl`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px 16px;
  margin: ${({ theme }) => theme.space(2)} 0;

  dt { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  dd { margin: 2px 0 0; font-weight: ${({ theme }) => theme.font.weight.semibold}; color: ${({ theme }) => theme.color.textStrong}; }
`;

const Bar = styled.div<{ $tone: Tone; $pct: number }>`
  height: 8px;
  border-radius: 4px;
  background: ${({ theme }) => theme.color.neutralTint};
  overflow: hidden;
  &::after {
    content: '';
    display: block;
    height: 100%;
    width: ${({ $pct }) => Math.min(100, $pct)}%;
    background: ${({ theme, $tone }) => ($tone === 'danger' ? theme.color.primary : theme.color[$tone])};
    border-radius: 4px;
  }
`;

const BarLabel = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textSoft};
`;

const History = styled.ul`
  list-style: none;
  margin: ${({ theme }) => theme.space(1)} 0 0;
  padding: 0;

  li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid ${({ theme }) => theme.color.border};
  }
  li:last-child { border-bottom: 0; }
  strong { display: block; color: ${({ theme }) => theme.color.textStrong}; }
  small { font-size: ${({ theme }) => theme.font.size.sm}; color: ${({ theme }) => theme.color.textSoft}; }
  b { white-space: nowrap; color: ${({ theme }) => theme.color.textStrong}; }
`;

const Inline = styled.form`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
  margin-top: ${({ theme }) => theme.space(2)};
  ${Input}, ${Select} { min-width: 0; }
  ${Input} { width: 140px; }
`;

const SubTitle = styled.h3`
  margin: ${({ theme }) => theme.space(3)} 0 0;
  font-size: ${({ theme }) => theme.font.size.lg};
  color: ${({ theme }) => theme.color.textStrong};
`;

const swapCode = (detail: string) => detail.replace(/[A-Z0-9]+/g, (p) => (TIRE_POSITIONS.some((t) => t.value === p) ? tireCode(p as TirePosition) : p));

function eventTitle(e: TireEvent): string {
  switch (e.kind) {
    case 'mount':
      if (e.measured_pct === 100) return 'Montagem pneu novo';
      return `Montagem (${e.detail ? `${e.detail.replace('.', ',')} · ` : ''}${fmtPct(e.measured_pct ?? 0)} de banda)`;
    case 'measure':
      return `Medição: ${e.detail ? `${e.detail.replace('.', ',')} (` : ''}${fmtPct(e.measured_pct ?? 0)} de banda${e.detail ? ')' : ''}`;
    case 'rotation':
      return `Rodízio (${swapCode(e.detail ?? '')})`;
    case 'retread':
      return `Recapagem${e.detail ? ` · ${e.detail}` : ''}`;
  }
}

type Action = 'measure' | 'rotate' | 'retread' | null;

function TireDetail({ tire, layout, simKm, readOnly }: { tire: Tire; layout: AxleLayout; simKm: number; readOnly: boolean }) {
  const events = useTireEvents(tire.id);
  const update = useUpdateTire();
  const rotate = useRotateTire();
  const retread = useRetreadTire();
  const remove = useDeleteTire();
  const [action, setAction] = useState<Action>(null);
  const [pct, setPct] = useState('');
  const [mm, setMm] = useState('');
  const [target, setTarget] = useState<TirePosition>('E1E');
  const [cost, setCost] = useState('');
  const tone = tireTone(tire.wear_pct);
  const error = update.error ?? rotate.error ?? retread.error ?? remove.error;

  useEffect(() => setAction(null), [tire.id]);

  const done = () => setAction(null);
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (action === 'measure') {
      update.mutate(tire.tread_new_mm ? { id: tire.id, measured_mm: Number(mm) } : { id: tire.id, measured_pct: Number(pct) }, { onSuccess: done });
    }
    if (action === 'rotate') rotate.mutate({ id: tire.id, position: target }, { onSuccess: done });
    if (action === 'retread') retread.mutate({ id: tire.id, cost: cost ? Number(cost) : null }, { onSuccess: done });
  }
  const open = (a: Action) => {
    setPct(String(Math.round(tire.estimated_pct)));
    setMm(tire.estimated_mm ? tire.estimated_mm.toFixed(1) : '');
    setTarget(LAYOUT_POSITIONS[layout].find((p) => p !== tire.position)!);
    setCost('');
    setAction(a);
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <CardTitle>{tirePositionLabel(tire.position)} ({tireCode(tire.position)})</CardTitle>
        <Pill $tone={tone}>{toneLabel[tone]}</Pill>
      </div>
      <Facts>
        <div><dt>Marca e medida</dt><dd>{tire.brand || '–'}</dd></div>
        <div><dt>Nº de fogo</dt><dd>{tire.identification || '–'}</dd></div>
        <div><dt>Km rodados neste pneu</dt><dd>{fmtKm(tire.km_on_tire)}</dd></div>
        <div><dt>Vida útil estimada</dt><dd>{fmtKm(tire.life_km)}</dd></div>
        <div><dt>Banda medida</dt><dd>{fmtPct(tire.measured_pct)} ({fmtDate(localDateISO(tire.measured_at))})</dd></div>
        {tire.tread_new_mm && tire.estimated_mm !== null && (
          <div>
            <dt>Sulco{simKm ? ' simulado' : ' estimado'}</dt>
            <dd>{fmtMm(tire.estimated_mm)} <small>(novo {fmtMm(tire.tread_new_mm)} · mínimo {fmtMm(LEGAL_MIN_MM)})</small></dd>
          </div>
        )}
        {tire.in_use && (
          <div>
            <dt>Rodízio</dt>
            <dd>{tire.km_to_rotation ? `em ~${fmtKm(tire.km_to_rotation)}` : 'já é hora'}</dd>
          </div>
        )}
        {tire.in_use && (
          <div>
            <dt>Troca (desgaste acima de 75%)</dt>
            <dd>{tire.km_to_replacement ? `em ~${fmtKm(tire.km_to_replacement)}` : 'agora'}</dd>
          </div>
        )}
        <div><dt>Recapagens</dt><dd>{tire.retreads}</dd></div>
        <div><dt>Preço pago</dt><dd>{tire.cost ? `${fmtBRL(tire.cost)} · ${fmtBRL(tire.cost_per_km ?? 0, 4)}/km` : '–'}</dd></div>
        <div><dt>Até o fim da banda</dt><dd>{tire.in_use ? `~${fmtKm(tire.remaining_km)}` : 'Estepe não gasta'}</dd></div>
      </Facts>
      <BarLabel><span>Desgaste</span><span>{fmtPct(Math.round(tire.wear_pct * 10) / 10)}</span></BarLabel>
      <Bar $tone={tone} $pct={tire.wear_pct} role="meter" aria-label="Desgaste" aria-valuemin={0} aria-valuemax={100} aria-valuenow={tire.wear_pct} />
      {tire.in_use && (
        <Muted style={{ marginTop: 8, fontSize: 12 }}>
          {fmtKm(tire.km_since_measure)} rodados em rotas desde a última medição (+{fmtPct(tire.wear_since_measure_pct)})
          {simKm ? `, mais ${fmtKm(simKm)} da simulação` : ''} · gasta {fmtPct(tire.wear_per_1000km_pct)} a cada 1.000 km
        </Muted>
      )}
      {layout === 'single' && tire.in_use && tone !== 'success' && (
        <Muted style={{ marginTop: 8, fontSize: 12 }}>
          Rodízio em tração dianteira (como a Ducato): os dianteiros vão para trás no mesmo lado e os traseiros vêm para a
          frente cruzando de lado. Recomendado a cada 5.000 a 10.000 km.
        </Muted>
      )}

      {!readOnly && !simKm && (
        <>
          {action ? (
            <Inline onSubmit={onSubmit} aria-label="Registrar no pneu">
              {action === 'measure' && tire.tread_new_mm && (
                <FieldLabel>
                  Sulco medido (mm)
                  <Input type="number" min={0} max={30} step={0.1} value={mm} onChange={(e) => setMm(e.target.value)} required autoFocus />
                </FieldLabel>
              )}
              {action === 'measure' && !tire.tread_new_mm && (
                <FieldLabel>
                  Banda restante (%)
                  <Input type="number" min={0} max={100} step={1} value={pct} onChange={(e) => setPct(e.target.value)} required autoFocus />
                </FieldLabel>
              )}
              {action === 'rotate' && (
                <FieldLabel>
                  Levar para
                  <Select value={target} onChange={(e) => setTarget(e.target.value as TirePosition)}>
                    {LAYOUT_POSITIONS[layout].filter((p) => p !== tire.position).map((p) => (
                      <option key={p} value={p}>{tirePositionLabel(p)} ({tireCode(p)})</option>
                    ))}
                  </Select>
                </FieldLabel>
              )}
              {action === 'retread' && (
                <FieldLabel>
                  Custo da recapagem (R$)
                  <Input type="number" min={0} step={0.01} value={cost} onChange={(e) => setCost(e.target.value)} autoFocus />
                </FieldLabel>
              )}
              <Button type="submit" disabled={update.isPending || rotate.isPending || retread.isPending}>Salvar</Button>
              <Button type="button" $variant="secondary" onClick={done}>Cancelar</Button>
            </Inline>
          ) : (
            <FormActions style={{ justifyContent: 'flex-start', marginTop: 16 }}>
              <Button type="button" $variant="secondary" onClick={() => open('measure')}>Nova medição</Button>
              <Button type="button" $variant="secondary" onClick={() => open('rotate')}>Rodízio</Button>
              <Button type="button" $variant="secondary" onClick={() => open('retread')}>Recapagem</Button>
              <Button
                type="button"
                $variant="secondary"
                disabled={remove.isPending}
                onClick={() => window.confirm(`Remover o pneu ${tirePositionLabel(tire.position)}?`) && remove.mutate(tire.id)}
              >
                Remover
              </Button>
            </FormActions>
          )}
          {action === 'rotate' && <Muted style={{ marginTop: 8, fontSize: 12 }}>Se a posição já tem pneu, os dois trocam de lugar.</Muted>}
        </>
      )}
      {error && <ErrorText role="alert" style={{ marginTop: 12 }}>{errorMessage(error)}</ErrorText>}

      <SubTitle>Histórico</SubTitle>
      {events.isLoading && <Muted>Carregando…</Muted>}
      {events.data?.length === 0 && <Muted style={{ marginTop: 8 }}>Sem registros ainda.</Muted>}
      {!!events.data?.length && (
        <History>
          {events.data.map((e) => (
            <li key={e.id}>
              <div>
                <strong>{eventTitle(e)}</strong>
                <small>{fmtDate(localDateISO(e.happened_at))} · {fmtKm(e.vehicle_km)} rodados em rotas</small>
              </div>
              {e.cost ? <b>{fmtBRL(e.cost)}</b> : null}
            </li>
          ))}
        </History>
      )}
    </>
  );
}

function AddTireForm({ vehicle, position }: { vehicle: Vehicle; position: TirePosition }) {
  const create = useCreateTire();
  const empty = { brand: '', identification: '', tread_new_mm: '', measured_mm: '', measured_pct: '100', life_km: '80000', cost: '' };
  const [form, setForm] = useState(empty);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => setForm(empty), [position]); // eslint-disable-line react-hooks/exhaustive-deps

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const inMm = Boolean(form.tread_new_mm && form.measured_mm);
    create.mutate({
      vehicleId: vehicle.id,
      position,
      brand: form.brand.trim() || null,
      identification: form.identification.trim() || null,
      tread_new_mm: form.tread_new_mm ? Number(form.tread_new_mm) : null,
      measured_mm: inMm ? Number(form.measured_mm) : null,
      measured_pct: inMm ? null : Number(form.measured_pct),
      life_km: Number(form.life_km),
      cost: form.cost ? Number(form.cost) : null,
    });
  }

  return (
    <form onSubmit={onSubmit} aria-label="Adicionar pneu">
      <CardTitle>{tirePositionLabel(position)} ({tireCode(position)})</CardTitle>
      <Muted style={{ margin: '4px 0 16px' }}>Posição sem pneu. Cadastre o pneu montado aqui.</Muted>
      <FormGrid style={{ marginBottom: 16 }}>
        <FieldLabel>
          Marca e medida
          <Input value={form.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="Michelin 215/75 R17.5" />
        </FieldLabel>
        <FieldLabel>
          Nº de fogo
          <Input value={form.identification} onChange={(e) => set({ identification: e.target.value })} placeholder="PN-00318" />
        </FieldLabel>
        <FieldLabel>
          Sulco do pneu novo (mm)
          <Input type="number" min={1.7} max={30} step={0.1} value={form.tread_new_mm} onChange={(e) => set({ tread_new_mm: e.target.value })} placeholder="9,1" />
        </FieldLabel>
        {form.tread_new_mm ? (
          <FieldLabel>
            Sulco medido hoje (mm) *
            <Input type="number" min={0} max={30} step={0.1} value={form.measured_mm} onChange={(e) => set({ measured_mm: e.target.value })} required />
          </FieldLabel>
        ) : (
          <FieldLabel>
            Banda restante (%) *
            <Input type="number" min={0} max={100} step={1} value={form.measured_pct} onChange={(e) => set({ measured_pct: e.target.value })} required />
          </FieldLabel>
        )}
        <FieldLabel>
          Vida útil da banda (km) *
          <Input type="number" min={5000} max={400000} step={1000} value={form.life_km} onChange={(e) => set({ life_km: e.target.value })} required />
        </FieldLabel>
        <FieldLabel>
          Preço pago (R$)
          <Input type="number" min={0} step={0.01} value={form.cost} onChange={(e) => set({ cost: e.target.value })} placeholder="1890" />
        </FieldLabel>
      </FormGrid>
      {create.isError && <ErrorText role="alert" style={{ marginBottom: 16 }}>{errorMessage(create.error)}</ErrorText>}
      <FormActions>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Salvando…' : 'Adicionar pneu'}</Button>
      </FormActions>
    </form>
  );
}

const Columns = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: ${({ theme }) => theme.space(2)};
  > :first-child { flex: 1 1 340px; }
  > :last-child { flex: 1.3 1 400px; }
`;

const SIM_STEPS = [0, 5000, 10000, 20000, 40000];

const Sim = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 ${({ theme }) => theme.space(2)};
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textSoft};
`;

const SimChip = styled.button<{ $active: boolean }>`
  height: 30px;
  padding: 0 10px;
  border-radius: 15px;
  border: 1.5px solid ${({ theme }) => theme.color.primary};
  background: ${({ theme, $active }) => ($active ? theme.color.primary : theme.color.surface)};
  color: ${({ theme, $active }) => ($active ? theme.color.textInvert : theme.color.primary)};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  cursor: pointer;
`;

/** Tela de pneus de um veículo: diagrama do desgaste por posição, ficha e histórico do pneu escolhido,
 *  e a simulação de como os pneus ficam depois de rodar mais. O gestor cadastra, mede, faz rodízio e recapagem;
 *  o motorista só acompanha. */
export function TireScreen({ vehicle, tires, readOnly = false }: { vehicle: Vehicle; tires: Tire[]; readOnly?: boolean }) {
  const layout = layoutOf(vehicle);
  const [simKm, setSimKm] = useState(0);
  const shown = tires.map((t) => project(t, simKm));
  const worst = [...tires].filter((t) => t.in_use).sort((a, b) => b.wear_pct - a.wear_pct)[0];
  const [selected, setSelected] = useState<TirePosition>(worst?.position ?? tires[0]?.position ?? 'E1E');
  const tire = shown.find((t) => t.position === selected);

  useEffect(() => {
    setSelected(worst?.position ?? tires[0]?.position ?? 'E1E');
    setSimKm(0);
  }, [vehicle.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Columns>
      <Card>
        <CardTitle style={{ marginBottom: 12 }}>Desgaste por posição</CardTitle>
        {tires.length > 0 && (
          <Sim role="group" aria-label="Simular desgaste">
            Simular:
            {SIM_STEPS.map((km) => (
              <SimChip key={km} type="button" $active={simKm === km} aria-pressed={simKm === km} onClick={() => setSimKm(km)}>
                {km ? `+${(km / 1000).toLocaleString('pt-BR')} mil km` : 'Hoje'}
              </SimChip>
            ))}
          </Sim>
        )}
        <TireDiagram tires={shown} layout={layout} selected={selected} onSelect={setSelected} />
        {simKm > 0 && (
          <Muted style={{ marginTop: 12, fontSize: 12 }}>
            Simulação: como os pneus ficariam depois de rodar mais {fmtKm(simKm)}, no ritmo de desgaste de cada um.
          </Muted>
        )}
      </Card>
      <Card aria-live="polite">
        {tire ? (
          <TireDetail tire={tire} layout={layout} simKm={simKm} readOnly={readOnly} />
        ) : readOnly ? (
          <>
            <CardTitle>{tirePositionLabel(selected)} ({tireCode(selected)})</CardTitle>
            <Muted style={{ marginTop: 8 }}>Sem pneu cadastrado nesta posição. Quem cadastra os pneus é a base.</Muted>
          </>
        ) : (
          <AddTireForm vehicle={vehicle} position={selected} />
        )}
      </Card>
    </Columns>
  );
}
