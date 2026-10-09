import { useMemo, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { allFieldDefs, resolveStatusIds } from '../../lib/filters.ts';
import type { Condition, FilterField } from '../../lib/types.ts';
import { Field } from '../../ui/ui.tsx';

export function FilterEditor({ initial, onApply, onCancel }: { initial?: Condition; onApply: (c: Condition) => void; onCancel: () => void }) {
  const { ref } = useApp();
  const defs = useMemo(() => allFieldDefs(ref.customFields), [ref.customFields]);
  const [field, setField] = useState<string>(initial?.field ?? 'status');
  const def = defs.find((d) => d.field === field) ?? defs[0];
  const [op, setOp] = useState<string>(initial?.op ?? def.ops[0].op);
  const opDef = def.ops.find((o) => o.op === op) ?? def.ops[0];
  const [value, setValue] = useState<unknown>(() => {
    if (!initial) return undefined;
    if (opDef.input === 'multi-status') return resolveStatusIds(initial.value, ref.statuses);
    return initial.value;
  });

  const changeField = (f: string) => {
    setField(f);
    const d = defs.find((x) => x.field === f)!;
    setOp(d.ops[0].op);
    setValue(undefined);
  };

  const list = (Array.isArray(value) ? value : []) as string[];
  const toggle = (id: string) => setValue(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const apply = () => {
    let v: unknown = value;
    if (opDef.input === 'number') v = Number(value ?? 0) || 0;
    if (opDef.input === 'none') v = undefined;
    if ((opDef.input.startsWith('multi') && !list.length) || ((opDef.input === 'text' || opDef.input === 'choice') && !String(value ?? '').trim())) return;
    onApply({ field: field as FilterField, op, ...(v !== undefined ? { value: v } : {}) });
  };

  const customDef = field.startsWith('custom:') ? ref.customFields.find((c) => `custom:${c.key}` === field) : null;

  return (
    <div className="col gap-12 filter-editor" style={{ padding: 8, width: 300 }}>
      <Field label="Feld">
        <select className="select" value={field} onChange={(e) => changeField(e.target.value)}>
          {[...new Set(defs.map((d) => d.group))].map((g) => (
            <optgroup key={g} label={g}>
              {defs.filter((d) => d.group === g).map((d) => (
                <option key={d.field} value={d.field}>
                  {d.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="Bedingung">
        <select className="select" value={op} onChange={(e) => { setOp(e.target.value); setValue(undefined); }}>
          {def.ops.map((o) => (
            <option key={o.op} value={o.op}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      {opDef.input === 'number' ? (
        <Field label="Anzahl">
          <input className="input" type="number" min={0} value={String(value ?? '')} onChange={(e) => setValue(e.target.value)} autoFocus />
        </Field>
      ) : null}
      {opDef.input === 'text' ? (
        <Field label="Wert">
          <input className="input" value={String(value ?? '')} onChange={(e) => setValue(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && apply()} />
        </Field>
      ) : null}
      {opDef.input === 'choice' && customDef ? (
        <Field label="Wert">
          <select className="select" value={String(value ?? '')} onChange={(e) => setValue(e.target.value)}>
            <option value="">– auswählen –</option>
            {customDef.choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {opDef.input === 'multi-choice' && customDef ? (
        <div className="col gap-4">
          {customDef.choices.map((c) => (
            <label key={c} className="check">
              <input type="checkbox" checked={list.includes(c)} onChange={() => toggle(c)} />
              {c}
            </label>
          ))}
        </div>
      ) : null}
      {opDef.input === 'multi-status' ? (
        <div className="col gap-4">
          {ref.statuses.map((s) => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={list.includes(s.id)} onChange={() => toggle(s.id)} />
              <span className="dot" style={{ width: 9, height: 9, borderRadius: '50%', background: s.color }} />
              {s.label}
            </label>
          ))}
        </div>
      ) : null}
      {opDef.input === 'multi-user' ? (
        <div className="col gap-4">
          {ref.profiles.filter((p) => p.active).map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={list.includes(p.id)} onChange={() => toggle(p.id)} />
              {p.full_name || p.email}
            </label>
          ))}
        </div>
      ) : null}
      {opDef.input === 'multi-outcome' ? (
        <div className="col gap-4">
          {ref.outcomes.map((o) => (
            <label key={o.key} className="check">
              <input type="checkbox" checked={list.includes(o.key)} onChange={() => toggle(o.key)} />
              {o.label}
            </label>
          ))}
        </div>
      ) : null}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn small" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="button" className="btn primary small" onClick={apply}>
          Übernehmen
        </button>
      </div>
    </div>
  );
}
