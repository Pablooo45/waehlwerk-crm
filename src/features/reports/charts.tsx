// Diagramme ohne Bibliothek: gestapelte Säulen (Emphasis) und Balkenlisten.
// Farben siehe .viz in styles.css (geprüft mit dem Palette-Validator).

import { useEffect, useRef, useState } from 'react';
import { formatNumber } from '../../lib/format.ts';

export interface ColumnDatum {
  key: string;
  label: string; // Achsenbeschriftung
  title: string; // Tooltip-Titel
  primary: number; // betonter Teil (unten)
  rest: number; // Rest (oben, grau)
  extra?: { label: string; value: string }[];
}

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(280, Math.floor(entries[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// Säule mit 4px runder Oberkante, unten eckig
function topRounded(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function StackedColumns({
  data,
  primaryLabel,
  restLabel,
  height = 220,
}: {
  data: ColumnDatum[];
  primaryLabel: string;
  restLabel: string;
  height?: number;
}) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 36;
  const padB = 24;
  const padT = 8;
  const innerW = width - padL - 8;
  const innerH = height - padB - padT;
  const max = niceMax(Math.max(1, ...data.map((d) => d.primary + d.rest)));
  const ticks = [0, max / 2, max];
  const band = data.length ? innerW / data.length : innerW;
  const barW = Math.max(4, Math.min(24, band * 0.62));
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const every = Math.max(1, Math.ceil(data.length / Math.floor(innerW / 44)));
  const h = hover !== null ? data[hover] : null;

  return (
    <div className="viz" ref={wrap} style={{ position: 'relative' }}>
      <div className="viz-legend">
        <span><i className="key accent" /> {primaryLabel}</span>
        <span><i className="key rest" /> {restLabel}</span>
      </div>
      <svg width={width} height={height} role="img" aria-label={`${primaryLabel} und ${restLabel} pro Tag`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - 8} y1={y(t)} y2={y(t)} className="viz-grid" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="viz-tick">
              {formatNumber(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + band * i + band / 2;
          const x = cx - barW / 2;
          const total = d.primary + d.rest;
          const hp = (d.primary / max) * innerH;
          const hr = (d.rest / max) * innerH;
          const base = padT + innerH;
          const gap = d.primary > 0 && d.rest > 0 ? 2 : 0;
          return (
            <g key={d.key} opacity={hover === null || hover === i ? 1 : 0.55}>
              {d.rest > 0 ? (
                <path d={topRounded(x, base - hp - hr, barW, Math.max(0, hr - gap))} className="viz-rest" />
              ) : null}
              {d.primary > 0 ? (
                d.rest > 0 ? (
                  <rect x={x} y={base - hp} width={barW} height={hp} className="viz-accent" />
                ) : (
                  <path d={topRounded(x, base - hp, barW, hp)} className="viz-accent" />
                )
              ) : null}
              {i % every === 0 ? (
                <text x={cx} y={height - 6} textAnchor="middle" className="viz-tick">
                  {d.label}
                </text>
              ) : null}
              <rect
                x={padL + band * i}
                y={padT}
                width={band}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.title}: ${total} gesamt, ${d.primary} ${primaryLabel}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                style={{ outline: 'none', cursor: 'default' }}
              />
            </g>
          );
        })}
        <line x1={padL} x2={width - 8} y1={padT + innerH} y2={padT + innerH} className="viz-axis" />
      </svg>
      {h && hover !== null ? (
        <div
          className="viz-tip"
          style={{
            left: Math.min(width - 190, Math.max(0, padL + band * hover + band / 2 - 90)),
            top: Math.max(0, y(h.primary + h.rest) - 10),
          }}
        >
          <div className="viz-tip-title">{h.title}</div>
          <div className="viz-tip-row"><i className="line accent" /><strong>{formatNumber(h.primary)}</strong><span>{primaryLabel}</span></div>
          <div className="viz-tip-row"><i className="line rest" /><strong>{formatNumber(h.rest)}</strong><span>{restLabel}</span></div>
          {(h.extra ?? []).map((e) => (
            <div className="viz-tip-row" key={e.label}><i className="line none" /><strong>{e.value}</strong><span>{e.label}</span></div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BarList({
  rows,
  total,
}: {
  rows: { key: string; label: string; color?: string; value: number }[];
  total?: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const sum = total ?? rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="barlist viz">
      {rows.map((r) => (
        <div className="barlist-row" key={r.key}>
          <span className="barlist-label" title={r.label}>
            {r.color ? <i className="dot" style={{ background: r.color }} /> : null}
            <span className="ellipsis">{r.label}</span>
          </span>
          <span className="barlist-track">
            <span className="barlist-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <strong className="barlist-value num">{formatNumber(r.value)}</strong>
          <span className="barlist-pct num muted">{sum ? `${Math.round((r.value / sum) * 100)} %` : ''}</span>
        </div>
      ))}
    </div>
  );
}
