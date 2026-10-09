import { Phone } from 'lucide-react';
import { useApp, usePhone } from '../../app/context.tsx';
import { useLookups } from '../../app/hooks.ts';
import { formatDue, formatPhone } from '../../lib/format.ts';
import type { LeadStatus } from '../../lib/types.ts';
import { cx, Tag } from '../../ui/ui.tsx';

export function StatusTag({ statusId }: { statusId: string | null }) {
  const { statusById } = useLookups();
  const s = statusId ? statusById.get(statusId) : undefined;
  if (!s) return <Tag tone="soft">ohne Status</Tag>;
  return <Tag color={s.color}>{s.label}</Tag>;
}

export function OutcomeTag({ outcome }: { outcome: string | null }) {
  const { outcomeByKey } = useLookups();
  if (!outcome) return null;
  const o = outcomeByKey.get(outcome);
  return <Tag color={o?.color ?? '#8a8f98'}>{o?.label ?? outcome}</Tag>;
}

export function DueTag({ due }: { due: string | null }) {
  const d = formatDue(due);
  return <Tag tone={d.overdue ? 'red' : 'soft'}>{d.text}</Tag>;
}

export function StatusSelect({
  value,
  onChange,
  statuses,
  allowEmpty,
  id,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  statuses: LeadStatus[];
  allowEmpty?: boolean;
  id?: string;
}) {
  const current = statuses.find((s) => s.id === value);
  return (
    <select
      id={id}
      className="select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      style={current ? { boxShadow: `inset 4px 0 0 ${current.color}` } : undefined}
    >
      {allowEmpty || !value ? <option value="">– kein Status –</option> : null}
      {statuses.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

export function UserSelect({
  value,
  onChange,
  emptyLabel = '– niemand –',
  id,
  onlyActive = true,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  emptyLabel?: string;
  id?: string;
  onlyActive?: boolean;
}) {
  const { ref } = useApp();
  const people = ref.profiles.filter((p) => !onlyActive || p.active || p.id === value);
  return (
    <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.full_name || p.email}
        </option>
      ))}
    </select>
  );
}

export function CallButton({
  number,
  leadId,
  contactId,
  leadName,
  contactName,
  label,
  small,
}: {
  number: string;
  leadId?: string | null;
  contactId?: string | null;
  leadName?: string | null;
  contactName?: string | null;
  label?: string;
  small?: boolean;
}) {
  const { dial } = useApp();
  const snap = usePhone();
  const busy = !!snap.call;
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dial({ number, leadId, contactId, leadName, contactName });
  };
  if (label) {
    return (
      <button type="button" className={cx('btn call', small && 'small')} onClick={onClick} disabled={busy}>
        <Phone />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={cx('icon-btn call', small && 'small')}
      onClick={onClick}
      disabled={busy}
      title={`${formatPhone(number)} anrufen`}
      aria-label={`${formatPhone(number)} anrufen`}
    >
      <Phone />
    </button>
  );
}

export { RecordingPlayer } from '../calls/Player.tsx';

export function PhoneNumber({ value }: { value: string }) {
  return <span className="number num">{formatPhone(value)}</span>;
}
