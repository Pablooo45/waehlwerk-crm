// Texte und Symbole für Workflows (Auslöser, Schritte, Ziele, Status)

import { Bell, CheckSquare, Filter, Mail, MessageCircle, Phone, PiggyBank, Repeat, UserPlus, Wand2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RefData, Workflow, WorkflowRun, WorkflowStep, WorkflowStepType, WorkflowTriggerType } from '../../lib/types.ts';
import { describeCondition } from '../../lib/filters.ts';
import type { FilterSet } from '../../lib/types.ts';

export const TRIGGERS: { value: WorkflowTriggerType; label: string; hint: string }[] = [
  { value: 'manual', label: 'Von Hand', hint: 'Leads werden einzeln oder per Sammelaktion aufgenommen.' },
  { value: 'lead_created', label: 'Neuer Lead', hint: 'Sobald ein Lead angelegt oder importiert wird.' },
  { value: 'status_changed', label: 'Status ändert sich', hint: 'Wenn ein Lead einen bestimmten Status bekommt.' },
  { value: 'call_outcome', label: 'Anruf-Ergebnis', hint: 'Nach einem Anruf mit bestimmtem Ergebnis.' },
  { value: 'meeting_booked', label: 'Termin gebucht', hint: 'Wenn ein Termin angelegt wird (CRM, Calendly, Google).' },
  { value: 'activity_created', label: 'Aktivität erfasst', hint: 'Wenn eine bestimmte eigene Aktivität gespeichert wird (z. B. Setting-Protokoll).' },
  { value: 'opportunity_status', label: 'Opportunity-Status', hint: 'Wenn eine Opportunity einen bestimmten Status bekommt.' },
];

export const STEP_TYPES: { value: WorkflowStepType; label: string; icon: ReactNode; hint: string }[] = [
  { value: 'email', label: 'E-Mail senden', icon: <Mail size={16} />, hint: 'Vorlage aus dem Postfach des Absenders.' },
  { value: 'sms', label: 'SMS senden', icon: <MessageCircle size={16} />, hint: 'SMS-Vorlage an die Handynummer.' },
  { value: 'call', label: 'Anruf-Aufgabe', icon: <Phone size={16} />, hint: 'Legt eine Anruf-Aufgabe in der Inbox an.' },
  { value: 'task', label: 'Aufgabe', icon: <CheckSquare size={16} />, hint: 'Legt eine Aufgabe in der Inbox an.' },
  { value: 'update_lead', label: 'Lead ändern', icon: <Wand2 size={16} />, hint: 'Status oder Felder setzen.' },
  { value: 'assign', label: 'Zuweisen (reihum)', icon: <UserPlus size={16} />, hint: 'Verteilt Leads der Reihe nach.' },
  { value: 'opportunity', label: 'Opportunity anlegen', icon: <PiggyBank size={16} />, hint: 'Neue Opportunity mit Status und Wert.' },
  { value: 'notify', label: 'Benachrichtigen', icon: <Bell size={16} />, hint: 'Nachricht in die Inbox von Kollegen.' },
  { value: 'filter', label: 'Bedingung prüfen', icon: <Filter size={16} />, hint: 'Nur weiter, wenn der Lead die Bedingung erfüllt.' },
];

export const GOALS: { value: Workflow['goal']['type']; label: string }[] = [
  { value: 'none', label: 'Kein Ziel – alle Schritte laufen' },
  { value: 'meeting', label: 'Termin gebucht' },
  { value: 'status', label: 'Lead bekommt Status …' },
  { value: 'outcome', label: 'Anruf mit Ergebnis …' },
  { value: 'replied', label: 'Lead antwortet (E-Mail oder SMS)' },
];

export const RUN_STATUS: Record<WorkflowRun['status'], { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'soft' }> = {
  active: { label: 'läuft', tone: 'blue' },
  paused: { label: 'pausiert', tone: 'amber' },
  finished: { label: 'fertig', tone: 'soft' },
  goal_met: { label: 'Ziel erreicht', tone: 'green' },
  canceled: { label: 'abgebrochen', tone: 'soft' },
  failed: { label: 'Fehler', tone: 'red' },
};

export const WF_STATUS: Record<Workflow['status'], { label: string; tone: 'green' | 'amber' | 'soft' }> = {
  active: { label: 'Aktiv', tone: 'green' },
  paused: { label: 'Pausiert', tone: 'amber' },
  draft: { label: 'Entwurf', tone: 'soft' },
};

export const STEP_ICON: Record<WorkflowStepType, ReactNode> = Object.fromEntries(STEP_TYPES.map((s) => [s.value, s.icon])) as Record<WorkflowStepType, ReactNode>;
export const REPEAT_ICON = <Repeat size={16} />;

const UNIT: Record<WorkflowStep['wait']['unit'], [string, string]> = {
  minutes: ['Minute', 'Minuten'],
  hours: ['Stunde', 'Stunden'],
  days: ['Tag', 'Tagen'],
};

export function describeWait(w: WorkflowStep['wait'], first: boolean): string {
  if (!w.amount) return first ? 'Sofort' : 'Direkt danach';
  const [one, many] = UNIT[w.unit];
  return `${first ? 'Nach' : 'Dann nach'} ${w.amount} ${w.amount === 1 ? (w.unit === 'days' ? 'Tag' : one) : many}`;
}

type Ref = Pick<RefData, 'statuses' | 'outcomes' | 'activityTypes' | 'oppStatuses' | 'profiles' | 'templates' | 'customFields' | 'me' | 'pipelines'>;

export function describeTrigger(wf: Pick<Workflow, 'trigger'>, ref: Ref): string {
  const t = wf.trigger;
  const v = t.value ?? null;
  switch (t.type) {
    case 'manual':
      return 'Von Hand aufgenommen';
    case 'lead_created':
      return 'Neuer Lead';
    case 'status_changed':
      return v ? `Status wird „${ref.statuses.find((s) => s.id === v)?.label ?? '?'}“` : 'Status ändert sich';
    case 'call_outcome':
      return v ? `Anruf-Ergebnis „${ref.outcomes.find((o) => o.key === v)?.label ?? v}“` : 'Anruf mit Ergebnis';
    case 'meeting_booked':
      return 'Termin gebucht';
    case 'activity_created':
      return v ? `Aktivität „${ref.activityTypes.find((a) => a.id === v)?.name ?? '?'}“` : 'Aktivität erfasst';
    case 'opportunity_status':
      return v ? `Opportunity wird „${ref.oppStatuses.find((s) => s.id === v)?.label ?? '?'}“` : 'Opportunity-Status ändert sich';
  }
}

export function describeGoal(wf: Pick<Workflow, 'goal'>, ref: Ref): string {
  const g = wf.goal;
  switch (g.type) {
    case 'none':
      return 'kein Ziel';
    case 'meeting':
      return 'Termin gebucht';
    case 'status':
      return `Status „${ref.statuses.find((s) => s.id === g.value)?.label ?? '?'}“`;
    case 'outcome':
      return `Ergebnis „${ref.outcomes.find((o) => o.key === g.value)?.label ?? g.value ?? '?'}“`;
    case 'replied':
      return 'Antwort erhalten';
  }
}

export function describeStep(step: WorkflowStep, ref: Ref): string {
  const c = step.config ?? {};
  const name = (id: unknown) => ref.profiles.find((p) => p.id === id)?.full_name ?? '?';
  switch (step.type) {
    case 'email':
      return `E-Mail „${ref.templates.find((t) => t.id === c.template_id)?.name ?? 'Vorlage fehlt'}“`;
    case 'sms':
      return c.template_id ? `SMS „${ref.templates.find((t) => t.id === c.template_id)?.name ?? 'Vorlage fehlt'}“` : `SMS: ${String(c.body ?? '').slice(0, 60) || 'Text fehlt'}`;
    case 'call':
      return `Anruf-Aufgabe „${String(c.title || 'Anrufen')}“`;
    case 'task':
      return `Aufgabe „${String(c.title || 'Aufgabe')}“`;
    case 'update_lead': {
      const parts: string[] = [];
      if (c.status_id) parts.push(`Status → ${ref.statuses.find((s) => s.id === c.status_id)?.label ?? '?'}`);
      if (c.custom && typeof c.custom === 'object') {
        for (const [k, v] of Object.entries(c.custom as Record<string, unknown>)) {
          parts.push(`${ref.customFields.find((f) => f.key === k)?.label ?? k} → ${Array.isArray(v) ? v.join(', ') : String(v)}`);
        }
      }
      return parts.length ? `Lead ändern: ${parts.join(', ')}` : 'Lead ändern';
    }
    case 'assign': {
      const ids = (c.user_ids as string[] | undefined) ?? [];
      return ids.length ? `Reihum zuweisen: ${ids.map(name).join(', ')}` : 'Zuweisen (niemand gewählt)';
    }
    case 'opportunity': {
      const st = ref.oppStatuses.find((s) => s.id === c.status_id);
      const pipe = ref.pipelines.find((p) => p.id === st?.pipeline_id);
      return `Opportunity ${st ? `„${st.label}“` : ''}${pipe ? ` in ${pipe.name}` : ''}${c.value ? `, ${Number(c.value).toLocaleString('de-DE')} €` : ''}`;
    }
    case 'notify': {
      const ids = (c.user_ids as string[] | undefined) ?? [];
      return `Benachrichtigen: ${ids.length ? ids.map(name).join(', ') : 'Zuständige Person'}`;
    }
    case 'filter': {
      const f = (c.filter as FilterSet | undefined) ?? { conditions: [] };
      return f.conditions.length ? `Nur weiter, wenn ${f.conditions.map((x) => describeCondition(x, ref)).join(f.match === 'any' ? ' oder ' : ' und ')}` : 'Bedingung (leer)';
    }
  }
}

export function newStep(type: WorkflowStepType): WorkflowStep {
  const id = Math.random().toString(36).slice(2, 9);
  const config: Record<string, unknown> =
    type === 'call' ? { title: 'Anrufen' } :
    type === 'task' ? { title: '' } :
    type === 'filter' ? { filter: { match: 'all', conditions: [] } } :
    {};
  return { id, type, wait: { amount: type === 'email' || type === 'sms' ? 0 : 1, unit: 'days' }, config };
}

export function blankWorkflow(userId: string): Workflow {
  const now = new Date().toISOString();
  return {
    id: '',
    name: '',
    description: '',
    status: 'draft',
    trigger: { type: 'manual', value: null, filters: {} },
    steps: [],
    goal: { type: 'meeting', value: null },
    send_window: { days: [1, 2, 3, 4, 5], from: '08:00', to: '18:00' },
    allow_reenroll: false,
    stop_on_reply: true,
    sender_mode: 'owner',
    sender_user: null,
    created_by: userId,
    created_at: now,
    updated_at: now,
  };
}
