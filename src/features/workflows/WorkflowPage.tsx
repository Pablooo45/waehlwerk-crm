// Einen Workflow bauen: Auslöser, Schritte mit Wartezeiten, Ziel, Versandfenster – und sehen, welche Leads gerade drin sind.

import { ArrowDown, ArrowLeft, ArrowUp, Copy, MoreHorizontal, Pause, Play, Plus, Save, Search, Trash2, UserPlus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { leadHref, navigate, routeHref } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { describeCondition } from '../../lib/filters.ts';
import { formatDateTime, formatRelative } from '../../lib/format.ts';
import type { Condition, FilterSet, Lead, Workflow, WorkflowRun, WorkflowStep, WorkflowStepType } from '../../lib/types.ts';
import { cx, Empty, errMsg, Field, Loading, MenuItem, Modal, Popover, Segmented, Tabs, Tag, useDebounced, useMenu, useUi } from '../../ui/ui.tsx';
import { FilterEditor } from '../leads/FilterEditor.tsx';
import {
  blankWorkflow,
  describeStep,
  describeWait,
  GOALS,
  newStep,
  RUN_STATUS,
  STEP_ICON,
  STEP_TYPES,
  TRIGGERS,
  WF_STATUS,
} from './meta.tsx';

const DAYS = [
  { n: 1, label: 'Mo' },
  { n: 2, label: 'Di' },
  { n: 3, label: 'Mi' },
  { n: 4, label: 'Do' },
  { n: 5, label: 'Fr' },
  { n: 6, label: 'Sa' },
  { n: 7, label: 'So' },
];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export default function WorkflowPage({ id }: { id: string }) {
  const { ref, me, can } = useApp();
  const isNew = id === 'new';
  const existing = ref.workflows.find((w) => w.id === id);
  const [tab, setTab] = useState<'build' | 'runs'>('build');

  if (!isNew && !existing) {
    return (
      <div className="page">
        <Empty title="Workflow nicht gefunden" action={<a className="btn" href="#/workflows">Zu den Workflows</a>}>Vielleicht wurde er gelöscht.</Empty>
      </div>
    );
  }
  const manage = can('manage_workflows');
  const initial = existing ? clone(existing) : blankWorkflow(me.id);

  return (
    <div className="page wf-page">
      <a href="#/workflows" className="back-link small"><ArrowLeft size={15} /> Workflows</a>
      {isNew ? (
        <WorkflowEditor initial={initial} isNew readOnly={!manage} />
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'build', label: 'Aufbau' },
              { value: 'runs', label: 'Leads im Workflow' },
            ]}
          />
          {tab === 'build' ? <WorkflowEditor key={existing!.updated_at} initial={initial} isNew={false} readOnly={!manage} /> : <RunsPanel workflow={existing!} />}
        </>
      )}
    </div>
  );
}

// ---------- Aufbau ----------

function WorkflowEditor({ initial, isNew, readOnly }: { initial: Workflow; isNew: boolean; readOnly: boolean }) {
  const { store, ref, reloadRef } = useApp();
  const { toast, confirm } = useUi();
  const [wf, setWf] = useState<Workflow>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const addMenu = useMenu();
  const more = useMenu();
  const dirty = JSON.stringify(wf) !== saved;

  const patch = (p: Partial<Workflow>) => setWf((w) => ({ ...w, ...p }));
  const setStep = (i: number, s: WorkflowStep) => setWf((w) => ({ ...w, steps: w.steps.map((x, j) => (j === i ? s : x)) }));
  const moveStep = (i: number, d: -1 | 1) =>
    setWf((w) => {
      const steps = [...w.steps];
      const j = i + d;
      if (j < 0 || j >= steps.length) return w;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...w, steps };
    });
  const removeStep = (i: number) => setWf((w) => ({ ...w, steps: w.steps.filter((_, j) => j !== i) }));
  const addStep = (t: WorkflowStepType) => {
    addMenu.close();
    setWf((w) => ({ ...w, steps: [...w.steps, newStep(t)] }));
  };

  const problems = useMemo(() => {
    const out: string[] = [];
    if (!wf.name.trim()) out.push('Name fehlt.');
    wf.steps.forEach((s, i) => {
      const c = s.config ?? {};
      if (s.type === 'email' && !c.template_id) out.push(`Schritt ${i + 1}: E-Mail-Vorlage wählen.`);
      if (s.type === 'sms' && !c.template_id && !String(c.body ?? '').trim()) out.push(`Schritt ${i + 1}: SMS-Vorlage oder Text fehlt.`);
      if (s.type === 'assign' && !((c.user_ids as string[] | undefined) ?? []).length) out.push(`Schritt ${i + 1}: Personen zum Zuweisen wählen.`);
      if (s.type === 'opportunity' && !c.status_id) out.push(`Schritt ${i + 1}: Opportunity-Status wählen.`);
      if ((s.type === 'call' || s.type === 'task') && !String(c.title ?? '').trim()) out.push(`Schritt ${i + 1}: Titel der Aufgabe fehlt.`);
    });
    if ((wf.goal.type === 'status' || wf.goal.type === 'outcome') && !wf.goal.value) out.push('Ziel: Wert auswählen.');
    if (['status_changed', 'call_outcome', 'activity_created', 'opportunity_status'].includes(wf.trigger.type) && !wf.trigger.value) out.push('Start: Wert auswählen.');
    if (wf.sender_mode === 'fixed' && !wf.sender_user) out.push('Absender wählen.');
    if (!wf.send_window.days.length) out.push('Mindestens einen Versandtag wählen.');
    return out;
  }, [wf]);

  const save = async (statusOverride?: Workflow['status']) => {
    const next = statusOverride ? { ...wf, status: statusOverride } : wf;
    if (problems.length) {
      toast(problems[0], { kind: 'error' });
      return;
    }
    if (next.status === 'active' && !next.steps.length) {
      toast('Ein aktiver Workflow braucht mindestens einen Schritt.', { kind: 'error' });
      return;
    }
    setBusy(true);
    try {
      const row: Partial<Workflow> = clone(next);
      if (isNew) delete row.id;
      delete row.created_at;
      delete row.updated_at;
      if (isNew) delete row.created_by;
      const res = await store.saveConfig('workflows', row, isNew);
      await reloadRef();
      bus.emit('workflows');
      toast(next.status === 'active' ? 'Gespeichert – der Workflow ist aktiv.' : 'Gespeichert.');
      if (isNew) navigate(routeHref({ name: 'workflow', id: res.id }));
      else {
        setWf(next);
        setSaved(JSON.stringify(next));
      }
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    more.close();
    try {
      const row: Partial<Workflow> = clone({ ...wf, name: `${wf.name} (Kopie)`, status: 'draft' as const });
      delete row.id;
      delete row.created_at;
      delete row.updated_at;
      delete row.created_by;
      const res = await store.saveConfig('workflows', row, true);
      await reloadRef();
      navigate(routeHref({ name: 'workflow', id: res.id }));
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const remove = async () => {
    more.close();
    if (!(await confirm(`Workflow „${wf.name}“ löschen? Laufende Leads werden gestoppt.`, { danger: true, confirmLabel: 'Löschen' }))) return;
    try {
      await store.deleteConfig('workflows', wf.id);
      await reloadRef();
      navigate('#/workflows');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const trig = TRIGGERS.find((t) => t.value === wf.trigger.type)!;
  const status = WF_STATUS[wf.status];

  return (
    <div className="wf-editor">
      <div className="page-head wf-head">
        <div className="grow col gap-4">
          <input
            className="input title-input"
            value={wf.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Name des Workflows"
            aria-label="Name des Workflows"
            readOnly={readOnly}
          />
          <input
            className="input subtle-input small"
            value={wf.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Kurze Beschreibung (optional)"
            aria-label="Beschreibung"
            readOnly={readOnly}
          />
        </div>
        <Tag tone={status.tone}>{status.label}</Tag>
        {!readOnly ? (
          <>
            {wf.status === 'active' ? (
              <button type="button" className="btn" onClick={() => save('paused')} disabled={busy}>
                <Pause /> Pausieren
              </button>
            ) : (
              <button type="button" className="btn call" onClick={() => save('active')} disabled={busy || !!problems.length}>
                <Play /> {isNew ? 'Speichern & aktivieren' : 'Aktivieren'}
              </button>
            )}
            <button type="button" className="btn primary" onClick={() => save()} disabled={busy || (!dirty && !isNew)}>
              <Save /> Speichern
            </button>
            {!isNew ? (
              <button type="button" className="icon-btn" onClick={more.open} aria-label="Weitere Aktionen">
                <MoreHorizontal />
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {readOnly ? <div className="callout"><span>Nur ansehen – ändern darf, wer das Recht „Workflows verwalten“ hat.</span></div> : null}
      {wf.status === 'active' && dirty && !readOnly ? (
        <div className="callout"><span>Änderungen gelten für neue Schritte laufender Leads, sobald du speicherst.</span></div>
      ) : null}

      <fieldset className="wf-fieldset" disabled={readOnly}>
        <section className="wf-block">
          <h2>Start</h2>
          <div className="grid-2">
            <Field label="Leads kommen in den Workflow, wenn …" hint={trig.hint}>
              <select className="select" value={wf.trigger.type} onChange={(e) => patch({ trigger: { ...wf.trigger, type: e.target.value as Workflow['trigger']['type'], value: null } })}>
                {TRIGGERS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            <TriggerValue wf={wf} onChange={(value) => patch({ trigger: { ...wf.trigger, value } })} />
          </div>
          {wf.trigger.type !== 'manual' ? (
            <details className="wf-more">
              <summary>Nur für bestimmte Leads ({(wf.trigger.filters?.status_ids?.length ?? 0) + (wf.trigger.filters?.owner_ids?.length ?? 0) || 'alle'})</summary>
              <div className="grid-2 mt-8">
                <Field label="Lead-Status">
                  <CheckList
                    items={ref.statuses.map((s) => ({ id: s.id, label: s.label, color: s.color }))}
                    value={wf.trigger.filters?.status_ids ?? []}
                    onChange={(status_ids) => patch({ trigger: { ...wf.trigger, filters: { ...wf.trigger.filters, status_ids } } })}
                    emptyLabel="egal"
                  />
                </Field>
                <Field label="Zuständig">
                  <CheckList
                    items={ref.profiles.filter((p) => p.active).map((p) => ({ id: p.id, label: p.full_name || p.email }))}
                    value={wf.trigger.filters?.owner_ids ?? []}
                    onChange={(owner_ids) => patch({ trigger: { ...wf.trigger, filters: { ...wf.trigger.filters, owner_ids } } })}
                    emptyLabel="egal"
                  />
                </Field>
              </div>
            </details>
          ) : null}
        </section>

        <section className="wf-block">
          <h2>Schritte</h2>
          {!wf.steps.length ? <p className="muted small">Noch keine Schritte. Füge unten den ersten hinzu.</p> : null}
          <ol className="wf-timeline">
            {wf.steps.map((s, i) => (
              <li key={s.id} className="wf-tl-item">
                <div className="wf-wait">
                  <span className="wf-wait-text">{describeWait(s.wait, i === 0)}</span>
                  <input
                    className="input small"
                    type="number"
                    min={0}
                    max={365}
                    value={s.wait.amount}
                    onChange={(e) => setStep(i, { ...s, wait: { ...s.wait, amount: Math.max(0, Number(e.target.value) || 0) } })}
                    aria-label={`Wartezeit vor Schritt ${i + 1}`}
                  />
                  <select className="select small" value={s.wait.unit} onChange={(e) => setStep(i, { ...s, wait: { ...s.wait, unit: e.target.value as WorkflowStep['wait']['unit'] } })} aria-label="Einheit">
                    <option value="minutes">Minuten</option>
                    <option value="hours">Stunden</option>
                    <option value="days">Tage</option>
                  </select>
                </div>
                <div className="wf-step">
                  <div className="wf-step-head">
                    <span className="wf-step-no">{i + 1}</span>
                    <span className="wf-step-icon">{STEP_ICON[s.type]}</span>
                    <strong className="grow">{STEP_TYPES.find((t) => t.value === s.type)?.label}</strong>
                    {!readOnly ? (
                      <span className="row gap-4">
                        <button type="button" className="icon-btn small" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Nach oben"><ArrowUp /></button>
                        <button type="button" className="icon-btn small" onClick={() => moveStep(i, 1)} disabled={i === wf.steps.length - 1} aria-label="Nach unten"><ArrowDown /></button>
                        <button type="button" className="icon-btn small" onClick={() => removeStep(i)} aria-label="Schritt entfernen"><Trash2 /></button>
                      </span>
                    ) : null}
                  </div>
                  <StepConfig step={s} onChange={(next) => setStep(i, next)} />
                  <p className="xs muted mt-4">{describeStep(s, ref)}</p>
                </div>
              </li>
            ))}
          </ol>
          {!readOnly ? (
            <button type="button" className="btn" onClick={addMenu.open}>
              <Plus /> Schritt hinzufügen
            </button>
          ) : null}
        </section>

        <section className="wf-block">
          <h2>Ziel & Regeln</h2>
          <div className="grid-2">
            <Field label="Ziel – dann stoppt der Workflow für den Lead">
              <select className="select" value={wf.goal.type} onChange={(e) => patch({ goal: { type: e.target.value as Workflow['goal']['type'], value: null } })}>
                {GOALS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </Field>
            {wf.goal.type === 'status' ? (
              <Field label="Status">
                <select className="select" value={wf.goal.value ?? ''} onChange={(e) => patch({ goal: { ...wf.goal, value: e.target.value || null } })}>
                  <option value="">– auswählen –</option>
                  {ref.statuses.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </Field>
            ) : wf.goal.type === 'outcome' ? (
              <Field label="Anruf-Ergebnis">
                <select className="select" value={wf.goal.value ?? ''} onChange={(e) => patch({ goal: { ...wf.goal, value: e.target.value || null } })}>
                  <option value="">– auswählen –</option>
                  {ref.outcomes.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
              </Field>
            ) : <div />}
          </div>
          <div className="col gap-8 mt-8">
            <label className="check">
              <input type="checkbox" checked={wf.stop_on_reply} onChange={(e) => patch({ stop_on_reply: e.target.checked })} />
              Stoppen, wenn der Lead per E-Mail oder SMS antwortet
            </label>
            <label className="check">
              <input type="checkbox" checked={wf.allow_reenroll} onChange={(e) => patch({ allow_reenroll: e.target.checked })} />
              Lead darf den Workflow mehrmals durchlaufen
            </label>
          </div>

          <div className="grid-2 mt-16">
            <Field label="E-Mails und SMS nur an diesen Tagen" hint="Anruf-Aufgaben und Lead-Änderungen laufen immer.">
              <div className="day-picker" role="group" aria-label="Versandtage">
                {DAYS.map((d) => (
                  <button
                    key={d.n}
                    type="button"
                    aria-pressed={wf.send_window.days.includes(d.n)}
                    onClick={() =>
                      patch({
                        send_window: {
                          ...wf.send_window,
                          days: wf.send_window.days.includes(d.n) ? wf.send_window.days.filter((x) => x !== d.n) : [...wf.send_window.days, d.n].sort(),
                        },
                      })
                    }
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Uhrzeit (deutsche Zeit)">
              <div className="row gap-8">
                <input className="input" type="time" value={wf.send_window.from} onChange={(e) => patch({ send_window: { ...wf.send_window, from: e.target.value } })} aria-label="von" />
                <span className="muted">bis</span>
                <input className="input" type="time" value={wf.send_window.to} onChange={(e) => patch({ send_window: { ...wf.send_window, to: e.target.value } })} aria-label="bis" />
              </div>
            </Field>
          </div>

          <div className="grid-2 mt-16">
            <Field label="Absender von E-Mails und SMS, Empfänger von Aufgaben">
              <select className="select" value={wf.sender_mode} onChange={(e) => patch({ sender_mode: e.target.value as Workflow['sender_mode'], sender_user: e.target.value === 'fixed' ? wf.sender_user : null })}>
                <option value="owner">Zuständige Person des Leads</option>
                <option value="enroller">Wer den Lead aufgenommen hat</option>
                <option value="fixed">Immer dieselbe Person</option>
              </select>
            </Field>
            {wf.sender_mode === 'fixed' ? (
              <Field label="Person">
                <select className="select" value={wf.sender_user ?? ''} onChange={(e) => patch({ sender_user: e.target.value || null })}>
                  <option value="">– auswählen –</option>
                  {ref.profiles.filter((p) => p.active).map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                  ))}
                </select>
              </Field>
            ) : <div />}
          </div>
        </section>
      </fieldset>

      {problems.length && !readOnly ? (
        <div className="callout warn mt-8">
          <ul className="plain-list small">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      ) : null}

      {addMenu.isOpen ? (
        <Popover anchor={addMenu.anchor} onClose={addMenu.close}>
          {STEP_TYPES.map((t) => (
            <MenuItem key={t.value} icon={t.icon} onClick={() => addStep(t.value)}>
              {t.label}
              <span className="block xs muted">{t.hint}</span>
            </MenuItem>
          ))}
        </Popover>
      ) : null}
      {more.isOpen ? (
        <Popover anchor={more.anchor} onClose={more.close} align="end">
          <MenuItem icon={<Copy />} onClick={duplicate}>Kopie anlegen</MenuItem>
          <MenuItem icon={<Trash2 />} danger onClick={remove}>Workflow löschen</MenuItem>
        </Popover>
      ) : null}
    </div>
  );
}

function TriggerValue({ wf, onChange }: { wf: Workflow; onChange: (v: string | null) => void }) {
  const { ref } = useApp();
  const v = wf.trigger.value ?? '';
  const sel = (label: string, options: { value: string; label: string }[]) => (
    <Field label={label}>
      <select className="select" value={v} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">– auswählen –</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
  switch (wf.trigger.type) {
    case 'status_changed':
      return sel('Neuer Status', ref.statuses.map((s) => ({ value: s.id, label: s.label })));
    case 'call_outcome':
      return sel('Ergebnis', ref.outcomes.map((o) => ({ value: o.key, label: o.label })));
    case 'activity_created':
      return sel('Formular', ref.activityTypes.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name })));
    case 'opportunity_status':
      return sel(
        'Opportunity-Status',
        ref.oppStatuses.map((s) => ({ value: s.id, label: `${ref.pipelines.find((p) => p.id === s.pipeline_id)?.name ?? ''}: ${s.label}` })),
      );
    default:
      return <div />;
  }
}

function CheckList({ items, value, onChange, emptyLabel }: { items: { id: string; label: string; color?: string }[]; value: string[]; onChange: (v: string[]) => void; emptyLabel?: string }) {
  return (
    <div className="checklist">
      {items.map((it) => (
        <label key={it.id} className="check">
          <input type="checkbox" checked={value.includes(it.id)} onChange={() => onChange(value.includes(it.id) ? value.filter((x) => x !== it.id) : [...value, it.id])} />
          {it.color ? <span className="dot" style={{ background: it.color }} aria-hidden="true" /> : null}
          {it.label}
        </label>
      ))}
      {!value.length && emptyLabel ? <span className="xs muted">{emptyLabel}</span> : null}
    </div>
  );
}

function StepConfig({ step, onChange }: { step: WorkflowStep; onChange: (s: WorkflowStep) => void }) {
  const { ref } = useApp();
  const c = step.config ?? {};
  const set = (p: Record<string, unknown>) => onChange({ ...step, config: { ...c, ...p } });
  const [filterEdit, setFilterEdit] = useState<{ index: number | null; anchor: HTMLElement } | null>(null);

  switch (step.type) {
    case 'email': {
      const tpls = ref.templates.filter((t) => t.kind === 'email');
      return (
        <Field label="E-Mail-Vorlage" hint={tpls.length ? 'Platzhalter wie {{ contact.first_name }} werden je Lead ausgefüllt.' : 'Noch keine Vorlagen – unter Einstellungen → Vorlagen anlegen.'}>
          <select className="select" value={String(c.template_id ?? '')} onChange={(e) => set({ template_id: e.target.value || null })}>
            <option value="">– auswählen –</option>
            {tpls.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>
      );
    }
    case 'sms': {
      const tpls = ref.templates.filter((t) => t.kind === 'sms');
      return (
        <div className="col gap-8">
          <Field label="SMS-Vorlage">
            <select className="select" value={String(c.template_id ?? '')} onChange={(e) => set({ template_id: e.target.value || null })}>
              <option value="">– eigener Text –</option>
              {tpls.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
          {!c.template_id ? (
            <Field label="Text" hint={`${String(c.body ?? '').length} Zeichen – über 160 werden es mehrere SMS.`}>
              <textarea className="textarea" rows={3} value={String(c.body ?? '')} onChange={(e) => set({ body: e.target.value })} />
            </Field>
          ) : null}
        </div>
      );
    }
    case 'call':
    case 'task':
      return (
        <Field label="Titel der Aufgabe">
          <input className="input" value={String(c.title ?? '')} onChange={(e) => set({ title: e.target.value })} placeholder={step.type === 'call' ? 'z. B. Nachfassen: Infos angekommen?' : 'z. B. Angebot vorbereiten'} />
        </Field>
      );
    case 'update_lead': {
      const custom = (c.custom as Record<string, unknown> | undefined) ?? {};
      const fields = ref.customFields.filter((f) => f.entity === 'lead' && ['choice', 'checkbox', 'text', 'number'].includes(f.type));
      const [k, val] = Object.entries(custom)[0] ?? ['', ''];
      const fd = fields.find((f) => f.key === k);
      return (
        <div className="grid-2">
          <Field label="Status setzen">
            <select className="select" value={String(c.status_id ?? '')} onChange={(e) => set({ status_id: e.target.value || null })}>
              <option value="">– nicht ändern –</option>
              {ref.statuses.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Feld setzen">
            <div className="row gap-4">
              <select className="select" value={k} onChange={(e) => set({ custom: e.target.value ? { [e.target.value]: '' } : undefined })} aria-label="Feld">
                <option value="">– kein Feld –</option>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
              {fd ? (
                fd.type === 'choice' ? (
                  <select className="select" value={String(val ?? '')} onChange={(e) => set({ custom: { [k]: e.target.value } })} aria-label="Wert">
                    <option value="">– leer –</option>
                    {fd.choices.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                  </select>
                ) : fd.type === 'checkbox' ? (
                  <select className="select" value={val === true ? 'ja' : 'nein'} onChange={(e) => set({ custom: { [k]: e.target.value === 'ja' } })} aria-label="Wert">
                    <option value="ja">ja</option>
                    <option value="nein">nein</option>
                  </select>
                ) : (
                  <input className="input" value={String(val ?? '')} onChange={(e) => set({ custom: { [k]: fd.type === 'number' ? Number(e.target.value) : e.target.value } })} aria-label="Wert" />
                )
              ) : null}
            </div>
          </Field>
        </div>
      );
    }
    case 'assign':
      return (
        <Field label="Reihum zuweisen an" hint="Der erste Lead geht an die erste Person, der nächste an die zweite usw.">
          <CheckList
            items={ref.profiles.filter((p) => p.active).map((p) => ({ id: p.id, label: p.full_name || p.email }))}
            value={(c.user_ids as string[] | undefined) ?? []}
            onChange={(user_ids) => set({ user_ids })}
          />
        </Field>
      );
    case 'opportunity':
      return (
        <div className="grid-2">
          <Field label="Pipeline und Status">
            <select className="select" value={String(c.status_id ?? '')} onChange={(e) => set({ status_id: e.target.value || null })}>
              <option value="">– auswählen –</option>
              {ref.pipelines.map((p) => (
                <optgroup key={p.id} label={p.name}>
                  {ref.oppStatuses.filter((s) => s.pipeline_id === p.id).map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label={`Wert (${ref.org.currency || 'EUR'})`}>
            <input className="input" type="number" min={0} value={String(c.value ?? '')} onChange={(e) => set({ value: Number(e.target.value) || 0 })} />
          </Field>
        </div>
      );
    case 'notify':
      return (
        <div className="col gap-8">
          <Field label="Wen benachrichtigen?" hint="Leer = zuständige Person des Leads.">
            <CheckList
              items={ref.profiles.filter((p) => p.active).map((p) => ({ id: p.id, label: p.full_name || p.email }))}
              value={(c.user_ids as string[] | undefined) ?? []}
              onChange={(user_ids) => set({ user_ids })}
            />
          </Field>
          <Field label="Nachricht">
            <input className="input" value={String(c.title ?? '')} onChange={(e) => set({ title: e.target.value })} placeholder="z. B. Heißer Lead – bitte heute anrufen" />
          </Field>
        </div>
      );
    case 'filter': {
      const filter = (c.filter as FilterSet | undefined) ?? { match: 'all', conditions: [] };
      const setFilter = (f: FilterSet) => set({ filter: f });
      const apply = (index: number | null, cond: Condition) => {
        const conditions = [...filter.conditions];
        if (index === null) conditions.push(cond);
        else conditions[index] = cond;
        setFilter({ ...filter, conditions });
        setFilterEdit(null);
      };
      return (
        <div className="col gap-8">
          <div className="row wrap gap-4">
            <span className="small">Nur weiter, wenn</span>
            <select className="select small" style={{ width: 'auto' }} value={filter.match ?? 'all'} onChange={(e) => setFilter({ ...filter, match: e.target.value as 'all' | 'any' })} aria-label="Verknüpfung">
              <option value="all">alle Bedingungen</option>
              <option value="any">mindestens eine</option>
            </select>
            <span className="small">zutreffen:</span>
          </div>
          <div className="filterbar" style={{ margin: 0 }}>
            {filter.conditions.map((cond, i) => (
              <span key={i} className="chip">
                <button type="button" onClick={(e) => setFilterEdit({ index: i, anchor: e.currentTarget })}>{describeCondition(cond, ref)}</button>
                <button type="button" aria-label="Bedingung entfernen" onClick={() => setFilter({ ...filter, conditions: filter.conditions.filter((_, j) => j !== i) })}>
                  <X size={14} />
                </button>
              </span>
            ))}
            <button type="button" className="btn small" onClick={(e) => setFilterEdit({ index: null, anchor: e.currentTarget })}>
              <Plus /> Bedingung
            </button>
          </div>
          {filterEdit ? (
            <Popover anchor={filterEdit.anchor} onClose={() => setFilterEdit(null)}>
              <FilterEditor initial={filterEdit.index !== null ? filter.conditions[filterEdit.index] : undefined} onApply={(cond) => apply(filterEdit.index, cond)} onCancel={() => setFilterEdit(null)} />
            </Popover>
          ) : null}
        </div>
      );
    }
  }
}

// ---------- Laufende Leads ----------

function RunsPanel({ workflow }: { workflow: Workflow }) {
  const { store, ref, can } = useApp();
  const { toast } = useUi();
  const { name } = useLookups();
  const [filter, setFilter] = useState<'running' | 'done' | 'all'>('running');
  const [enroll, setEnroll] = useState(false);
  const runs = useAsync(
    () =>
      store.listWorkflowRuns({
        workflowId: workflow.id,
        status: filter === 'running' ? ['active', 'paused'] : filter === 'done' ? ['finished', 'goal_met', 'canceled', 'failed'] : undefined,
        limit: 500,
      }),
    [store, workflow.id, filter],
    ['workflows', 'tasks'],
  );

  const setStatus = async (r: WorkflowRun, status: 'active' | 'paused' | 'canceled') => {
    try {
      await store.setWorkflowRunStatus(r.id, status);
      bus.emit('workflows');
      toast(status === 'canceled' ? 'Für diesen Lead beendet.' : status === 'paused' ? 'Pausiert.' : 'Läuft weiter.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const rows = runs.data ?? [];
  return (
    <section className="section">
      <div className="row wrap">
        <Segmented
          value={filter}
          onChange={setFilter}
          label="Läufe filtern"
          options={[
            { value: 'running', label: 'Laufen' },
            { value: 'done', label: 'Beendet' },
            { value: 'all', label: 'Alle' },
          ]}
        />
        <span className="grow" />
        <button type="button" className="btn" onClick={() => setEnroll(true)} disabled={workflow.status !== 'active'} title={workflow.status !== 'active' ? 'Erst aktivieren' : undefined}>
          <UserPlus /> Leads aufnehmen
        </button>
      </div>
      {runs.loading && !runs.data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title={filter === 'running' ? 'Gerade sind keine Leads in diesem Workflow' : 'Noch nichts beendet'}>
          {workflow.trigger.type === 'manual' ? 'Nimm Leads über „Leads aufnehmen“ oder per Sammelaktion in der Leadliste auf.' : 'Leads kommen automatisch, sobald der Auslöser passt.'}
        </Empty>
      ) : (
        <div className="table-wrap mt-12">
          <table className="table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Status</th>
                <th className="hide-mobile">Schritt</th>
                <th className="hide-mobile">Nächster Schritt</th>
                <th className="hide-mobile">Gestartet</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = RUN_STATUS[r.status];
                const step = workflow.steps[r.step_index];
                const last = r.log[r.log.length - 1];
                const running = r.status === 'active' || r.status === 'paused';
                return (
                  <tr key={r.id}>
                    <td>
                      {r.lead ? <a href={leadHref(r.lead.id)}>{r.lead.name}</a> : <span className="muted">gelöscht</span>}
                      {last ? <div className="xs muted ellipsis" style={{ maxWidth: 280 }} title={last.result}>{last.result}</div> : null}
                    </td>
                    <td>
                      <Tag tone={st.tone}>{st.label}</Tag>
                      {r.end_reason && !running ? <div className="xs muted">{r.end_reason}</div> : null}
                    </td>
                    <td className="hide-mobile small">
                      {running && step ? `${r.step_index + 1} von ${workflow.steps.length}: ${STEP_TYPES.find((t) => t.value === step.type)?.label}` : `${Math.min(r.step_index, workflow.steps.length)} von ${workflow.steps.length}`}
                    </td>
                    <td className="hide-mobile small nowrap">{running && r.next_at ? formatDateTime(r.next_at) : '–'}</td>
                    <td className="hide-mobile small nowrap" title={formatDateTime(r.started_at)}>
                      {formatRelative(r.started_at)}
                      {r.started_by ? <div className="xs muted">{name(r.started_by)}</div> : <div className="xs muted">automatisch</div>}
                    </td>
                    <td>
                      {running ? (
                        <div className="row gap-4 nowrap">
                          {r.status === 'active' ? (
                            <button type="button" className="icon-btn small" onClick={() => setStatus(r, 'paused')} aria-label="Pausieren" title="Pausieren"><Pause /></button>
                          ) : (
                            <button type="button" className="icon-btn small" onClick={() => setStatus(r, 'active')} aria-label="Fortsetzen" title="Fortsetzen"><Play /></button>
                          )}
                          <button type="button" className="icon-btn small" onClick={() => setStatus(r, 'canceled')} aria-label="Beenden" title="Für diesen Lead beenden"><X /></button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {enroll ? <EnrollModal workflow={workflow} onClose={() => setEnroll(false)} bulkAllowed={can('bulk_workflow') || can('manage_workflows')} smartViews={ref.smartViews} /> : null}
    </section>
  );
}

function EnrollModal({ workflow, onClose, bulkAllowed, smartViews }: { workflow: Workflow; onClose: () => void; bulkAllowed: boolean; smartViews: { id: string; name: string; filters: FilterSet; sort: import('../../lib/types.ts').SortSpec }[] }) {
  const { store } = useApp();
  const { toast } = useUi();
  const [mode, setMode] = useState<'one' | 'view'>('one');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [picked, setPicked] = useState<Lead[]>([]);
  const [viewId, setViewId] = useState('');
  const [busy, setBusy] = useState(false);
  const found = useAsync(() => (dq.trim().length >= 2 ? store.searchLeads(dq, 8) : Promise.resolve([])), [store, dq]);
  const view = smartViews.find((v) => v.id === viewId);
  const count = useAsync(() => (view ? store.countLeads(view.filters) : Promise.resolve(0)), [store, viewId]);

  const run = async () => {
    setBusy(true);
    try {
      let ids = picked.map((l) => l.id);
      if (mode === 'view' && view) ids = await store.listLeadIds(view.filters, view.sort, 2000);
      if (!ids.length) return;
      const n = await store.enrollInWorkflow(workflow.id, ids);
      bus.emit('workflows');
      toast(n ? `${n} ${n === 1 ? 'Lead' : 'Leads'} aufgenommen.` : 'Niemand aufgenommen – die Leads waren schon drin oder sind gesperrt.');
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Leads in „${workflow.name}“ aufnehmen`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={run} disabled={busy || (mode === 'one' ? !picked.length : !view || !count.data)}>
            {mode === 'one' ? `${picked.length || ''} aufnehmen` : `${(count.data ?? 0).toLocaleString('de-DE')} Leads aufnehmen`}
          </button>
        </>
      }
    >
      <div className="col gap-12">
        {bulkAllowed ? (
          <Segmented value={mode} onChange={setMode} label="Auswahl" options={[{ value: 'one', label: 'Einzelne Leads' }, { value: 'view', label: 'Aus Smart View' }]} />
        ) : null}
        {mode === 'one' ? (
          <>
            <div className="search">
              <Search />
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lead suchen (Name, Ort, Nummer)" autoFocus />
            </div>
            <div className="list">
              {(found.data ?? []).map((l) => {
                const on = picked.some((p) => p.id === l.id);
                return (
                  <label key={l.id} className={cx('list-item check', on && 'selected')}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setPicked(on ? picked.filter((p) => p.id !== l.id) : bulkAllowed ? [...picked, l] : [l])}
                    />
                    <span className="grow">{l.name}<span className="block xs muted">{l.address_city}</span></span>
                  </label>
                );
              })}
            </div>
            {picked.length ? <p className="small">Ausgewählt: {picked.map((p) => p.name).join(', ')}</p> : null}
          </>
        ) : (
          <Field label="Smart View" hint="Alle Leads der Ansicht (bis 2.000). Leads mit „Nicht anrufen“ überspringen Workflows mit Anrufen und SMS.">
            <select className="select" value={viewId} onChange={(e) => setViewId(e.target.value)}>
              <option value="">– auswählen –</option>
              {smartViews.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

export function EnrollInWorkflowModal({ leadIds, onClose, contactId }: { leadIds: string[]; onClose: () => void; contactId?: string | null }) {
  const { store, ref } = useApp();
  const { toast } = useUi();
  const active = ref.workflows.filter((w) => w.status === 'active');
  const [wfId, setWfId] = useState(active[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const wf = active.find((w) => w.id === wfId);

  const run = async () => {
    if (!wf) return;
    setBusy(true);
    try {
      const n = await store.enrollInWorkflow(wf.id, leadIds, contactId ?? null);
      bus.emit('workflows');
      toast(n ? `${n} ${n === 1 ? 'Lead' : 'Leads'} in „${wf.name}“ aufgenommen.` : 'Niemand aufgenommen – schon drin oder gesperrt.');
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={leadIds.length > 1 ? `${leadIds.length} Leads in Workflow aufnehmen` : 'In Workflow aufnehmen'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={run} disabled={busy || !wf}>Aufnehmen</button>
        </>
      }
    >
      {!active.length ? (
        <p className="muted">Es gibt keinen aktiven Workflow. <a href="#/workflows">Workflows ansehen</a></p>
      ) : (
        <div className="col gap-12">
          <Field label="Workflow">
            <select className="select" value={wfId} onChange={(e) => setWfId(e.target.value)}>
              {active.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </Field>
          {wf ? (
            <ol className="steps-list small">
              {wf.steps.map((s, i) => (
                <li key={s.id}><span className="muted">{describeWait(s.wait, i === 0)}:</span> {describeStep(s, ref)}</li>
              ))}
            </ol>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
