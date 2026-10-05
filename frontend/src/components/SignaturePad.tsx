import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button, Muted } from './ui';

const Pad = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;

  canvas {
    width: 100%;
    height: 160px;
    border: 1px dashed ${({ theme }) => theme.color.borderStrong};
    border-radius: ${({ theme }) => theme.radius};
    background: #fff;
    touch-action: none; /* o dedo desenha em vez de rolar a tela */
    cursor: crosshair;
  }
  div { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  ${Button} { height: 32px; padding: 0 10px; }
`;

export interface SignaturePadHandle {
  /** PNG da assinatura, ou nulo se ninguém assinou */
  toBlob: () => Promise<Blob | null>;
}

/** Quadro para quem recebe assinar com o dedo na tela do celular. */
export const SignaturePad = forwardRef<SignaturePadHandle, { label: string }>(function SignaturePad({ label }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    // Resolução real da tela, para o traço não ficar borrado
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a1a';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setSigned(false);
  };

  useImperativeHandle(ref, () => ({
    toBlob: () => new Promise((resolve) => (signed && canvas.current ? canvas.current.toBlob(resolve, 'image/png') : resolve(null))),
  }), [signed]);

  return (
    <Pad>
      <canvas
        ref={canvas}
        aria-label={label}
        role="img"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext('2d')!;
          const [x, y] = point(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          const [x, y] = point(e);
          ctx.lineTo(x, y);
          ctx.stroke();
          setSigned(true);
        }}
        onPointerUp={() => { drawing.current = false; }}
        onPointerCancel={() => { drawing.current = false; }}
      />
      <div>
        <Muted style={{ fontSize: 12 }}>{signed ? 'Assinado.' : 'Peça para quem recebeu assinar com o dedo.'}</Muted>
        <Button type="button" $variant="secondary" onClick={clear} disabled={!signed}>Limpar</Button>
      </div>
    </Pad>
  );
});
