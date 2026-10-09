// Gruppen (Teams) – für Gruppennummern, Berichte und Workflows.

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import type { Group } from '../../lib/types.ts';
import { Avatar, cx, useUi } from '../../ui/ui.tsx';
import { ColorInput, useSaver } from './shared.tsx';

export default function Groups() {
  const { store, ref } = useApp();
  const save = useSaver();
  const [name, setName] = useState('');

  const add = async () => {
    if (!name.trim()) return;
    if (await save(() => store.saveConfig('groups', { name: name.trim(), color: '#0e8a5f' }))) setName('');
  };

  return (
    <section className="section">
      <h2>Gruppen</h2>
      <p className="muted">
        Fasst Personen zusammen, z. B. „Opener-Team“ und „Closing“. Gruppen kannst du einer Telefonnummer zuweisen (alle klingeln oder
        reihum), in Berichten filtern und in Workflows verwenden.
      </p>
      <div className="col gap-12">
        {ref.groups.map((g) => (
          <GroupCard key={g.id} group={g} />
        ))}
        {!ref.groups.length ? <p className="small muted">Noch keine Gruppen.</p> : null}
      </div>
      <div className="row wrap mt-16">
        <input className="input" style={{ maxWidth: 260 }} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Neue Gruppe, z. B. Opener-Team" />
        <button type="button" className="btn" disabled={!name.trim()} onClick={add}>
          <Plus /> Gruppe anlegen
        </button>
      </div>
    </section>
  );
}

function GroupCard({ group }: { group: Group }) {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const members = ref.groupMembers.filter((m) => m.group_id === group.id).map((m) => m.user_id);
  const usedBy = ref.phoneNumbers.filter((n) => n.group_id === group.id);

  const toggle = (userId: string, on: boolean) =>
    save(() => store.setGroupMembers(group.id, on ? [...members, userId] : members.filter((u) => u !== userId)));

  return (
    <div className="panel">
      <div className="panel-head row">
        <ColorInput value={group.color} onChange={(v) => save(() => store.saveConfig('groups', { id: group.id, color: v }))} />
        <input
          className="input grow"
          defaultValue={group.name}
          aria-label="Name der Gruppe"
          onBlur={(e) => e.target.value.trim() && e.target.value !== group.name && save(() => store.saveConfig('groups', { id: group.id, name: e.target.value.trim() }))}
        />
        <span className="small muted nowrap">{members.length} {members.length === 1 ? 'Person' : 'Personen'}</span>
        <button
          type="button"
          className="icon-btn small"
          aria-label="Gruppe löschen"
          onClick={async () => {
            const extra = usedBy.length ? ` Die Nummer ${usedBy.map((n) => n.label || n.number).join(', ')} klingelt danach beim ganzen Team.` : '';
            if (await confirm(`Gruppe „${group.name}“ löschen?${extra}`, { danger: true, confirmLabel: 'Löschen' })) save(() => store.deleteConfig('groups', group.id));
          }}
        >
          <Trash2 />
        </button>
      </div>
      <div className="panel-body row wrap gap-8">
        {ref.profiles.filter((p) => p.active).map((p) => {
          const on = members.includes(p.id);
          return (
            <label key={p.id} className={cx('person-toggle', on && 'on')}>
              <input type="checkbox" checked={on} onChange={(e) => toggle(p.id, e.target.checked)} />
              <Avatar name={p.full_name || p.email} color={p.color} />
              {p.full_name || p.email}
            </label>
          );
        })}
      </div>
    </div>
  );
}
