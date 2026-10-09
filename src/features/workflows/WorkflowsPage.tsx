// Workflows (Sequenzen): automatische Abläufe aus E-Mails, SMS, Anruf-Aufgaben und Lead-Änderungen.

import { Plus, Workflow as WorkflowIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { routeHref } from '../../app/router.ts';
import { formatRelative } from '../../lib/format.ts';
import { Empty, Loading, Tag } from '../../ui/ui.tsx';
import { describeGoal, describeTrigger, STEP_ICON, WF_STATUS } from './meta.tsx';

export default function WorkflowsPage() {
  const { store, ref, can } = useApp();
  const { name } = useLookups();
  const runs = useAsync(() => store.listWorkflowRuns({ status: ['active', 'paused', 'goal_met', 'finished'], limit: 5000 }), [store], ['workflows']);
  const manage = can('manage_workflows');

  const stats = useMemo(() => {
    const m = new Map<string, { active: number; goal: number; total: number }>();
    for (const r of runs.data ?? []) {
      const s = m.get(r.workflow_id) ?? { active: 0, goal: 0, total: 0 };
      s.total++;
      if (r.status === 'active' || r.status === 'paused') s.active++;
      if (r.status === 'goal_met') s.goal++;
      m.set(r.workflow_id, s);
    }
    return m;
  }, [runs.data]);

  const list = [...ref.workflows].sort((a, b) => ['active', 'paused', 'draft'].indexOf(a.status) - ['active', 'paused', 'draft'].indexOf(b.status) || a.name.localeCompare(b.name));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Workflows <span className="muted num" style={{ fontWeight: 500 }}>{list.length || ''}</span></h1>
        {manage ? (
          <a className="btn primary" href="#/workflows/new">
            <Plus /> Neuer Workflow
          </a>
        ) : null}
      </div>
      <p className="muted small" style={{ marginTop: -6 }}>
        Automatische Abläufe: z. B. nach „Entscheider gesprochen“ eine Info-Mail senden und zwei Tage später eine Anruf-Aufgabe anlegen. Stoppt automatisch, wenn das Ziel erreicht ist.
      </p>

      {runs.loading && !runs.data ? (
        <Loading />
      ) : !list.length ? (
        <Empty title="Noch keine Workflows" action={manage ? <a className="btn primary" href="#/workflows/new"><Plus /> Ersten Workflow anlegen</a> : undefined}>
          {manage ? 'Leg einen Ablauf an – Leads kommen automatisch hinein oder per Sammelaktion.' : 'Workflows legt an, wer das Recht „Workflows verwalten“ hat.'}
        </Empty>
      ) : (
        <div className="wf-grid">
          {list.map((w) => {
            const s = stats.get(w.id) ?? { active: 0, goal: 0, total: 0 };
            const st = WF_STATUS[w.status];
            return (
              <a key={w.id} href={routeHref({ name: 'workflow', id: w.id })} className="wf-card">
                <div className="row">
                  <WorkflowIcon size={18} aria-hidden="true" />
                  <strong className="grow ellipsis">{w.name}</strong>
                  <Tag tone={st.tone}>{st.label}</Tag>
                </div>
                {w.description ? <p className="small muted wf-desc">{w.description}</p> : null}
                <div className="wf-steps" aria-label={`${w.steps.length} Schritte`}>
                  {w.steps.map((step) => (
                    <span key={step.id} className="wf-step-dot" title={step.type}>{STEP_ICON[step.type]}</span>
                  ))}
                  {!w.steps.length ? <span className="xs muted">noch keine Schritte</span> : null}
                </div>
                <dl className="wf-facts small">
                  <div><dt>Start</dt><dd>{describeTrigger(w, ref)}</dd></div>
                  <div><dt>Ziel</dt><dd>{describeGoal(w, ref)}</dd></div>
                </dl>
                <div className="row wrap gap-8 xs muted mt-8">
                  <span><strong className="num" style={{ color: 'var(--ink)' }}>{s.active}</strong> laufen</span>
                  <span><strong className="num" style={{ color: 'var(--ink)' }}>{s.goal}</strong> Ziel erreicht</span>
                  <span className="grow" />
                  <span>{name(w.created_by)}, {formatRelative(w.updated_at)}</span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
