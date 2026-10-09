// Rollen & Rechte – wie in Close: vordefinierte Rollen plus beliebig viele eigene Rollen
// mit einzelnen Rechten und Lead-Sichtbarkeit.

import { Check, Copy, Lock, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, slugKey, VISIBILITY_OPTIONS, visibilityLabel } from '../../lib/perms.ts';
import type { LeadVisibility, Permission, Role } from '../../lib/types.ts';
import { Avatar, cx, Field, Segmented, Tag, useUi } from '../../ui/ui.tsx';
import { useSaver } from './shared.tsx';

type Mode = 'edit' | 'compare';

export default function Roles() {
  const { ref } = useApp();
  const [mode, setMode] = useState<Mode>('edit');
  const [selected, setSelected] = useState<string>(ref.roles.find((r) => !r.is_builtin)?.id ?? 'user');
  const role = ref.roles.find((r) => r.id === selected) ?? ref.roles[0];
  const members = (id: string) => ref.profiles.filter((p) => p.role_id === id && p.active);

  return (
    <section className="section">
      <div className="row wrap" style={{ marginBottom: 6 }}>
        <h2 className="grow">Rollen & Rechte</h2>
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          label="Ansicht"
          options={[
            { value: 'edit', label: 'Bearbeiten' },
            { value: 'compare', label: 'Vergleich' },
          ]}
        />
      </div>
      <p className="muted">
        Jede Person hat genau eine Rolle. Die vier vordefinierten Rollen entsprechen denen in Close; für alles dazwischen legst du
        eigene Rollen an (z. B. „Opener“ nur mit eigenen Leads). Die Rechte prüft auch der Server – ausgeblendete Knöpfe allein sind kein Schutz.
      </p>
      {mode === 'compare' ? (
        <CompareMatrix />
      ) : (
        <div className="roles-layout">
          <div className="roles-list" role="list">
            {ref.roles.map((r) => (
              <button
                key={r.id}
                type="button"
                role="listitem"
                className={cx('role-item', r.id === role?.id && 'active')}
                onClick={() => setSelected(r.id)}
              >
                <span className="grow">
                  <strong>
                    {r.id === 'admin' ? <ShieldCheck size={14} aria-hidden="true" /> : null} {r.name}
                  </strong>
                  <span className="block xs muted">
                    {r.is_builtin ? 'vordefiniert' : 'eigene Rolle'}, {members(r.id).length} {members(r.id).length === 1 ? 'Person' : 'Personen'}
                  </span>
                </span>
                {r.is_builtin ? <Lock size={14} aria-label="vordefiniert" /> : null}
              </button>
            ))}
            <NewRoleButton onCreated={setSelected} />
          </div>
          {role ? <RoleEditor key={role.id + role.updated_at} role={role} onDuplicated={setSelected} onDeleted={() => setSelected('user')} /> : null}
        </div>
      )}
    </section>
  );
}

function NewRoleButton({ onCreated }: { onCreated: (id: string) => void }) {
  const { store, ref } = useApp();
  const save = useSaver();
  const create = async () => {
    const name = `Neue Rolle ${ref.roles.filter((r) => !r.is_builtin).length + 1}`;
    const id = slugKey(name, ref.roles.map((r) => r.id));
    const ok = await save(() => store.saveConfig('roles', { id, name, description: '', permissions: ['calling', 'delete_own_activities', 'delete_own_tasks'], lead_visibility: 'all', sort: 100 + ref.roles.length }, true));
    if (ok) onCreated(id);
  };
  return (
    <button type="button" className="btn mt-8" onClick={create}>
      <Plus /> Neue Rolle
    </button>
  );
}

function RoleEditor({ role, onDuplicated, onDeleted }: { role: Role; onDuplicated: (id: string) => void; onDeleted: () => void }) {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const locked = role.is_builtin;
  const effective = role.id === 'admin' ? ALL_PERMISSIONS : role.permissions;
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [visibility, setVisibility] = useState<LeadVisibility>(role.id === 'admin' ? 'all' : role.lead_visibility);
  const [perms, setPerms] = useState<Permission[]>(effective);
  const members = ref.profiles.filter((p) => p.role_id === role.id && p.active);
  const dirty = name !== role.name || description !== role.description || visibility !== role.lead_visibility || [...perms].sort().join() !== [...role.permissions].sort().join();

  useEffect(() => {
    setPerms(role.id === 'admin' ? ALL_PERMISSIONS : role.permissions);
  }, [role]);

  const toggle = (p: Permission, on: boolean) => setPerms((cur) => (on ? [...new Set([...cur, p])] : cur.filter((x) => x !== p)));

  const submit = () =>
    save(() => store.saveConfig('roles', { id: role.id, name: name.trim() || role.name, description, lead_visibility: visibility, permissions: perms }), 'Rolle gespeichert.');

  const duplicate = async () => {
    const newName = `${role.name} (Kopie)`;
    const id = slugKey(newName, ref.roles.map((r) => r.id));
    const ok = await save(() =>
      store.saveConfig('roles', { id, name: newName, description: role.description, permissions: [...effective], lead_visibility: role.id === 'admin' ? 'all' : role.lead_visibility, sort: 100 + ref.roles.length }, true)
    );
    if (ok) onDuplicated(id);
  };

  const remove = async () => {
    if (members.length) return;
    if (!(await confirm(`Rolle „${role.name}“ löschen?`, { danger: true, confirmLabel: 'Löschen' }))) return;
    if (await save(() => store.deleteConfig('roles', role.id), 'Rolle gelöscht.')) onDeleted();
  };

  return (
    <div className="role-editor">
      {locked ? (
        <div className="callout" style={{ marginBottom: 14 }}>
          <Lock />
          <span>
            {role.id === 'admin'
              ? 'Admins dürfen immer alles – diese Rolle ist fest.'
              : 'Vordefinierte Rollen sind fest (wie in Close). Für andere Rechte: Rolle kopieren und anpassen.'}
          </span>
        </div>
      ) : null}
      <div className="form-grid">
        <Field label="Name">
          <input className="input" value={name} disabled={locked} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Beschreibung">
          <input className="input" value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} placeholder="Wofür ist die Rolle gedacht?" />
        </Field>
      </div>

      <h3 className="mt-16">Welche Leads sieht die Rolle?</h3>
      <div className="col gap-8 mt-8">
        {VISIBILITY_OPTIONS.map((o) => (
          <label key={o.value} className="check" style={{ alignItems: 'flex-start' }}>
            <input type="radio" name={`vis-${role.id}`} checked={visibility === o.value} disabled={locked} onChange={() => setVisibility(o.value)} style={{ marginTop: 3 }} />
            <span>
              <strong>{o.label}</strong>
              <br />
              <span className="small muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <h3 className="mt-16">Rechte</h3>
      <div className="perm-groups">
        {PERMISSION_GROUPS.map((g) => {
          const on = g.items.filter((i) => perms.includes(i.key)).length;
          return (
            <fieldset key={g.title} className="perm-group">
              <legend>
                {g.title} <span className="muted small">{on}/{g.items.length}</span>
              </legend>
              {!locked ? (
                <div className="row gap-4 perm-bulk">
                  <button type="button" className="btn small ghost" onClick={() => setPerms((cur) => [...new Set([...cur, ...g.items.map((i) => i.key)])])}>Alle</button>
                  <button type="button" className="btn small ghost" onClick={() => setPerms((cur) => cur.filter((p) => !g.items.some((i) => i.key === p)))}>Keine</button>
                </div>
              ) : null}
              {g.items.map((i) => (
                <label key={i.key} className="check perm" title={i.hint}>
                  <input type="checkbox" checked={perms.includes(i.key)} disabled={locked} onChange={(e) => toggle(i.key, e.target.checked)} />
                  <span>
                    {i.label}
                    {i.hint ? <span className="block xs muted">{i.hint}</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
          );
        })}
      </div>

      <div className="row wrap mt-16">
        {!locked ? (
          <button type="button" className="btn primary" onClick={submit} disabled={!dirty}>
            Speichern
          </button>
        ) : null}
        <button type="button" className="btn" onClick={duplicate}>
          <Copy /> Als eigene Rolle kopieren
        </button>
        {!locked ? (
          <button type="button" className="btn ghost" onClick={remove} disabled={members.length > 0} title={members.length ? 'Erst allen Personen eine andere Rolle geben' : undefined}>
            <Trash2 /> Löschen
          </button>
        ) : null}
      </div>

      <h3 className="mt-24">
        <Users size={16} aria-hidden="true" /> Personen mit dieser Rolle
      </h3>
      {members.length ? (
        <div className="row wrap gap-8 mt-8">
          {members.map((p) => (
            <a key={p.id} href="#/settings/team" className="person-chip">
              <Avatar name={p.full_name || p.email} color={p.color} />
              {p.full_name || p.email}
            </a>
          ))}
        </div>
      ) : (
        <p className="small muted mt-8">Noch niemand. Die Rolle vergibst du unter <a href="#/settings/team">Benutzer</a>.</p>
      )}
    </div>
  );
}

function CompareMatrix() {
  const { ref } = useApp();
  const roles = ref.roles;
  const effective = useMemo(() => new Map(roles.map((r) => [r.id, new Set(r.id === 'admin' ? ALL_PERMISSIONS : r.permissions)])), [roles]);
  return (
    <div className="table-wrap">
      <table className="table compare">
        <thead>
          <tr>
            <th>Recht</th>
            {roles.map((r) => (
              <th key={r.id} className="center">{r.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Sichtbare Leads</strong></td>
            {roles.map((r) => (
              <td key={r.id} className="center small">{visibilityLabel(r.id === 'admin' ? 'all' : r.lead_visibility)}</td>
            ))}
          </tr>
          {PERMISSION_GROUPS.map((g) => (
            <Fragment key={g.title}>
              <tr className="group-row">
                <td colSpan={roles.length + 1}>{g.title}</td>
              </tr>
              {g.items.map((i) => (
                <tr key={i.key}>
                  <td title={i.hint}>{i.label}</td>
                  {roles.map((r) => (
                    <td key={r.id} className="center">
                      {effective.get(r.id)?.has(i.key) ? <Check size={16} aria-label="ja" className="yes" /> : <span className="muted" aria-label="nein">–</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="small muted mt-8">
        <Tag tone="soft">Tipp</Tag> Eine Rolle mit „Nur eigene Leads“ sieht auch Anrufe, Notizen und Aufnahmen nur zu diesen Leads.
      </p>
    </div>
  );
}
