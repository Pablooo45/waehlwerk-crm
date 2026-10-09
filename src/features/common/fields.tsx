// Eingabe und Anzeige für eigene Felder (Lead, Kontakt, Opportunity) und Formular-Felder.

import type { ActivityField, CustomField, CustomFieldType, Profile } from '../../lib/types.ts';
import { formatDate, formatDateTime } from '../../lib/format.ts';
import { cx } from '../../ui/ui.tsx';
import { UserSelect } from './bits.tsx';

export interface FieldShape {
  key: string;
  label: string;
  type: CustomFieldType;
  choices?: string[];
  required?: boolean;
  description?: string;
}

export function shapeOf(f: CustomField | ActivityField): FieldShape {
  return { key: f.key, label: f.label, type: f.type as CustomFieldType, choices: f.choices ?? [], required: 'required' in f ? f.required : false, description: f.description };
}

function toLocal(v: unknown, withTime: boolean): string {
  if (!v) return '';
  const s = String(v);
  if (!withTime) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Eingabefeld passend zum Feldtyp. „inline“ = schlichte Darstellung in der Lead-Seitenleiste.
export function FieldInput({
  field,
  value,
  onChange,
  disabled,
  inline,
  id,
}: {
  field: FieldShape;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  inline?: boolean;
  id?: string;
}) {
  const cls = inline ? 'inline-edit' : 'input';
  const str = value == null ? '' : String(value);
  switch (field.type) {
    case 'checkbox':
      return (
        <input
          id={id}
          type="checkbox"
          checked={value === true || value === 'true'}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-label={field.label}
        />
      );
    case 'choice':
      return (
        <select id={id} className={inline ? 'inline-edit' : 'select'} value={str} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} aria-label={field.label}>
          <option value="">–</option>
          {(field.choices ?? []).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
          {str && !(field.choices ?? []).includes(str) ? <option value={str}>{str}</option> : null}
        </select>
      );
    case 'multichoice': {
      const list = Array.isArray(value) ? (value as string[]) : value ? [String(value)] : [];
      return (
        <div className={cx('multi-choice', inline && 'inline')} role="group" aria-label={field.label}>
          {(field.choices ?? []).map((c) => {
            const on = list.includes(c);
            return (
              <button
                key={c}
                type="button"
                className={cx('chip-btn', on && 'active')}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onChange(on ? list.filter((x) => x !== c) : [...list, c])}
              >
                {c}
              </button>
            );
          })}
        </div>
      );
    }
    case 'textarea':
      return <textarea id={id} className={inline ? 'inline-edit textarea-inline' : 'textarea'} rows={inline ? 2 : 3} value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={field.label} />;
    case 'number':
      return (
        <input
          id={id}
          className={cls}
          type="number"
          inputMode="decimal"
          value={str}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          disabled={disabled}
          aria-label={field.label}
        />
      );
    case 'date':
      return <input id={id} className={cls} type="date" value={toLocal(value, false)} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} aria-label={field.label} />;
    case 'datetime':
      return (
        <input
          id={id}
          className={cls}
          type="datetime-local"
          value={toLocal(value, true)}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
          disabled={disabled}
          aria-label={field.label}
        />
      );
    case 'user':
      return <UserSelect id={id} value={str || null} onChange={(v) => onChange(v)} emptyLabel="–" />;
    case 'url':
      return <input id={id} className={cls} type="url" value={str} onChange={(e) => onChange(e.target.value || null)} placeholder="https://…" disabled={disabled} aria-label={field.label} />;
    default:
      return <input id={id} className={cls} value={str} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} aria-label={field.label} />;
  }
}

// Wert lesbar machen (Verlauf, Listen, Export)
export function formatFieldValue(field: FieldShape, value: unknown, profiles: Profile[]): string {
  if (value == null || value === '') return '';
  switch (field.type) {
    case 'checkbox':
      return value === true || value === 'true' ? 'ja' : 'nein';
    case 'multichoice':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'date':
      return formatDate(String(value));
    case 'datetime':
      return formatDateTime(String(value));
    case 'number':
      return Number(value).toLocaleString('de-DE');
    case 'user': {
      const p = profiles.find((x) => x.id === value);
      return p ? p.full_name || p.email : '–';
    }
    default:
      return String(value);
  }
}

export function isEmptyValue(v: unknown): boolean {
  return v == null || v === '' || (Array.isArray(v) && !v.length);
}
