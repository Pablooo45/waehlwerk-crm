// Benutzer verwalten: anlegen, Rolle & Funktion, Gruppen, Nummer, Weiterleitung, deaktivieren, löschen.

import { Copy, KeyRound, Mail, Pencil, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { formatPhone, normalizePhone } from '../../lib/format.ts';
import { roleOf } from '../../lib/perms.ts';
import type { Profile, Role, TeamFunction } from '../../lib/types.ts';
import { Avatar, copyText, cx, errMsg, Field, Modal, Segmented, Tag, useUi } from '../../ui/ui.tsx';
import { PALETTE, useSaver } from './shared.tsx';

export const FUNCTIONS: { value: TeamFunction; label: string }[] = [
  { value: 'opener', label: 'Opener' },
  { value: 'setter', label: 'Setter' },
  { value: 'closer', label: 'Closer' },
  { value: 'manager', label: 'Teamleitung' },
  { value: 'other', label: 'Sonstiges' },
];

export function functionLabel(f: TeamFunction): string {
  return FUNCTIONS.find((x) => x.value === f)?.label ?? f;
}

function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => chars[x % chars.length]).join('');
}

type Filter = 'active' | 'inactive' | 'all';

export default function Team() {
  const { ref, me } = useApp();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [reset, setReset] = useState<Profile | null>(null);
  const [removing, setRemoving] = useState<Profile | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');

  const groupsOf = (id: string) =>
    ref.groupMembers.filter((m) => m.user_id === id).map((m) => ref.groups.find((g) => g.id === m.group_id)).filter(Boolean);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return ref.profiles
      .filter((p) => (filter === 'all' ? true : filter === 'active' ? p.active : !p.active))
      .filter((p) => !term || p.full_name.toLowerCase().includes(term) || p.email.includes(term))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.full_name.localeCompare(b.full_name, 'de'));
  }, [ref.profiles, filter, q]);

  const activeCount = ref.profiles.filter((p) => p.active).length;

  return (
    <>
      <section className="section">
        <div className="row wrap" style={{ marginBottom: 6 }}>
          <h2 className="grow">Benutzer</h2>
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            <UserPlus /> Person hinzufügen
          </button>
        </div>
        <p className="muted">
          Jede Person bekommt einen eigenen Zugang. Was jemand sehen und tun darf, bestimmt die <a href="#/settings/roles">Rolle</a>.
          {' '}{activeCount} aktive {activeCount === 1 ? 'Person' : 'Personen'}.
        </p>
        <div className="row wrap toolbar">
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            label="Anzeigen"
            options={[
              { value: 'active', label: 'Aktiv' },
              { value: 'inactive', label: 'Deaktiviert' },
              { value: 'all', label: 'Alle' },
            ]}
          />
          <input className="input" style={{ maxWidth: 240 }} placeholder="Name oder E-Mail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Benutzer suchen" />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Rolle</th>
                <th className="hide-mobile">Funktion</th>
                <th className="hide-mobile">Gruppen</th>
                <th className="hide-mobile">Absendernummer</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const role = roleOf(ref, p);
                return (
                  <tr key={p.id} className={cx(!p.active && 'dimmed')}>
                    <td>
                      <span className="row nowrap">
                        <Avatar name={p.full_name || p.email} color={p.color} />
                        <span>
                          <strong>{p.full_name || '–'}</strong> {p.id === me.id ? <Tag tone="soft">du</Tag> : null}
                          {!p.active ? <Tag tone="red">deaktiviert</Tag> : null}
                          <span className="block xs muted">{p.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="row nowrap gap-4">
                        {role?.id === 'admin' ? <ShieldCheck size={15} aria-hidden="true" /> : null}
                        {role?.name ?? p.role_id}
                      </span>
                    </td>
                    <td className="hide-mobile">{functionLabel(p.team_function)}</td>
                    <td className="hide-mobile">
                      <span className="row wrap gap-4">
                        {groupsOf(p.id).map((g) => (
                          <Tag key={g!.id} color={g!.color}>{g!.name}</Tag>
                        ))}
                      </span>
                    </td>
                    <td className="hide-mobile num nowrap">{p.phone_number ? formatPhone(p.phone_number) : <span className="muted">Standard</span>}</td>
                    <td className="nowrap" style={{ textAlign: 'right' }}>
                      <button type="button" className="icon-btn" onClick={() => setEditing(p)} title="Bearbeiten" aria-label={`${p.full_name || p.email} bearbeiten`}>
                        <Pencil />
                      </button>
                      <button type="button" className="icon-btn" onClick={() => setReset(p)} title="Passwort neu setzen" aria-label={`Passwort von ${p.full_name || p.email} neu setzen`}>
                        <KeyRound />
                      </button>
                      {p.id !== me.id ? (
                        <button type="button" className="icon-btn" onClick={() => setRemoving(p)} title="Löschen" aria-label={`${p.full_name || p.email} löschen`}>
                          <Trash2 />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length ? <p className="small muted mt-12">Niemand gefunden.</p> : null}
      </section>
      {adding ? <AddPersonModal onClose={() => setAdding(false)} /> : null}
      {editing ? <EditPersonModal person={editing} onClose={() => setEditing(null)} /> : null}
      {reset ? <ResetModal person={reset} onClose={() => setReset(null)} /> : null}
      {removing ? <RemoveModal person={removing} onClose={() => setRemoving(null)} /> : null}
    </>
  );
}

function CopyField({ value }: { value: string }) {
  const { toast } = useUi();
  return (
    <div className="row">
      <input className="input num" readOnly value={value} onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className="icon-btn"
        aria-label="Kopieren"
        onClick={async (e) => {
          if (await copyText(value)) toast('Kopiert.');
          else {
            (e.currentTarget.previousElementSibling as HTMLInputElement | null)?.select();
            toast('Bitte markierten Text von Hand kopieren.');
          }
        }}
      >
        <Copy />
      </button>
    </div>
  );
}

export function RoleSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const { ref } = useApp();
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {ref.roles.map((r: Role) => (
        <option key={r.id} value={r.id}>
          {r.name}
          {r.is_builtin ? '' : ' (eigene Rolle)'}
        </option>
      ))}
    </select>
  );
}

function RoleHint({ roleId }: { roleId: string }) {
  const { ref } = useApp();
  const role = ref.roles.find((r) => r.id === roleId);
  if (!role) return null;
  return <span>{role.description || 'Eigene Rolle.'} <a href="#/settings/roles">Rechte ansehen</a></span>;
}

function GroupChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { ref } = useApp();
  if (!ref.groups.length) return <span className="small muted">Noch keine Gruppen. <a href="#/settings/groups">Gruppe anlegen</a></span>;
  return (
    <div className="row wrap gap-12">
      {ref.groups.map((g) => (
        <label key={g.id} className="check">
          <input type="checkbox" checked={value.includes(g.id)} onChange={(e) => onChange(e.target.checked ? [...value, g.id] : value.filter((x) => x !== g.id))} />
          {g.name}
        </label>
      ))}
    </div>
  );
}

function AddPersonModal({ onClose }: { onClose: () => void }) {
  const { store, reloadRef, demo } = useApp();
  const { toast } = useUi();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [fn, setFn] = useState<TeamFunction>('opener');
  const [roleId, setRoleId] = useState('user');
  const [groups, setGroups] = useState<string[]>([]);
  const [mode, setMode] = useState<'password' | 'invite'>('password');
  const [password] = useState(randomPassword());
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await store.admin('create_user', {
        email,
        full_name: name,
        team_function: fn,
        role_id: roleId,
        group_ids: groups,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        ...(mode === 'invite' ? { invite: true, redirectTo: `${location.origin}${location.pathname}` } : { password }),
      });
      await reloadRef();
      setDone(true);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={done ? 'Zugang angelegt' : 'Person hinzufügen'}
      onClose={onClose}
      wide
      footer={
        done ? (
          <button type="button" className="btn primary" onClick={onClose}>Fertig</button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
            <button type="button" className="btn primary" onClick={save} disabled={busy || !email.trim()}>Zugang anlegen</button>
          </>
        )
      }
    >
      {done ? (
        mode === 'invite' ? (
          <p>
            {name || email} bekommt eine E-Mail mit einem Link, um ein eigenes Passwort festzulegen.
            {demo ? ' (In der Demo wird keine E-Mail verschickt.)' : ''}
          </p>
        ) : (
          <div className="col gap-12">
            <p>Gib {name || email} diese Zugangsdaten. Das Passwort lässt sich danach unter „Mein Profil“ ändern.</p>
            <Field label="Adresse des CRM"><CopyField value={`${location.origin}${location.pathname}`} /></Field>
            <Field label="E-Mail"><CopyField value={email} /></Field>
            <Field label="Startpasswort"><CopyField value={password} /></Field>
          </div>
        )
      ) : (
        <div className="col gap-16">
          <div className="form-grid">
            <Field label="Name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="E-Mail">
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Rolle" hint={<RoleHint roleId={roleId} />}>
              <RoleSelect value={roleId} onChange={setRoleId} />
            </Field>
            <Field label="Funktion" hint="Für Berichte und Termin-Zuordnung (Opener, Setter, Closer).">
              <select className="select" value={fn} onChange={(e) => setFn(e.target.value as TeamFunction)}>
                {FUNCTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Gruppen">
            <GroupChecks value={groups} onChange={setGroups} />
          </Field>
          <Field label="Zugang">
            <Segmented<'password' | 'invite'>
              value={mode}
              onChange={setMode}
              label="Zugang"
              options={[
                { value: 'password', label: 'Startpasswort anzeigen' },
                { value: 'invite', label: 'Einladung per E-Mail' },
              ]}
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function EditPersonModal({ person, onClose }: { person: Profile; onClose: () => void }) {
  const { store, ref, me } = useApp();
  const save = useSaver();
  const [name, setName] = useState(person.full_name);
  const [email, setEmail] = useState(person.email);
  const [roleId, setRoleId] = useState(person.role_id);
  const [fn, setFn] = useState<TeamFunction>(person.team_function);
  const [phone, setPhone] = useState(person.phone_number ?? '');
  const [forward, setForward] = useState(person.forward_number ?? '');
  const [forwardMode, setForwardMode] = useState(person.forward_mode);
  const [color, setColor] = useState(person.color);
  const [active, setActive] = useState(person.active);
  const [groups, setGroups] = useState(ref.groupMembers.filter((m) => m.user_id === person.id).map((m) => m.group_id));
  const [busy, setBusy] = useState(false);
  const numbers = ref.phoneNumbers;

  const submit = async () => {
    if (forward && !normalizePhone(forward)) return;
    setBusy(true);
    const ok = await save(async () => {
      await store.admin('update_user', {
        id: person.id,
        full_name: name.trim(),
        email: email.trim().toLowerCase(),
        role_id: roleId,
        team_function: fn,
        phone_number: phone || null,
        forward_number: forward ? normalizePhone(forward) : null,
        forward_mode: forward ? forwardMode : 'never',
        color,
        active,
      });
      const before = ref.groupMembers.filter((m) => m.user_id === person.id).map((m) => m.group_id);
      for (const g of ref.groups) {
        const was = before.includes(g.id);
        const now = groups.includes(g.id);
        if (was === now) continue;
        const members = ref.groupMembers.filter((m) => m.group_id === g.id).map((m) => m.user_id);
        await store.setGroupMembers(g.id, now ? [...members, person.id] : members.filter((u) => u !== person.id));
      }
    }, 'Gespeichert.');
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={`${person.full_name || person.email} bearbeiten`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={submit} disabled={busy || !email.trim()}>Speichern</button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="form-grid">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="E-Mail" hint="Ist auch der Benutzername bei der Anmeldung.">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Rolle" hint={<RoleHint roleId={roleId} />}>
            <RoleSelect value={roleId} onChange={setRoleId} />
          </Field>
          <Field label="Funktion">
            <select className="select" value={fn} onChange={(e) => setFn(e.target.value as TeamFunction)}>
              {FUNCTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Absendernummer" hint="Diese Nummer sehen Angerufene. Leer = Standardnummer.">
            <select className="select" value={phone} onChange={(e) => setPhone(e.target.value)}>
              <option value="">Standard ({ref.org.default_caller_id ? formatPhone(ref.org.default_caller_id) : 'keine'})</option>
              {numbers.map((n) => (
                <option key={n.number} value={n.number}>{formatPhone(n.number)}{n.label ? ` – ${n.label}` : ''}</option>
              ))}
              {phone && !numbers.some((n) => n.number === phone) ? <option value={phone}>{formatPhone(phone)}</option> : null}
            </select>
          </Field>
          <Field label="Farbe">
            <div className="swatches">
              {PALETTE.map((c) => (
                <button key={c} type="button" className={cx('swatch', c === color && 'active')} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Farbe ${c}`} aria-pressed={c === color} />
              ))}
            </div>
          </Field>
          <Field label="Weiterleitung aufs Handy" hint={forward && !normalizePhone(forward) ? 'Die Nummer ist ungültig.' : 'Klingelt, wenn die Person im CRM nicht abnimmt oder nicht stören eingestellt hat.'}>
            <input className="input" type="tel" value={forward} onChange={(e) => setForward(e.target.value)} placeholder="0151 …" />
          </Field>
          <Field label="Wann weiterleiten?">
            <select className="select" value={forwardMode} onChange={(e) => setForwardMode(e.target.value as Profile['forward_mode'])} disabled={!forward}>
              <option value="no_answer">Wenn im Browser niemand abnimmt</option>
              <option value="always">Immer direkt aufs Handy</option>
              <option value="never">Nie</option>
            </select>
          </Field>
        </div>
        <Field label="Gruppen">
          <GroupChecks value={groups} onChange={setGroups} />
        </Field>
        {person.id !== me.id ? (
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Zugang aktiv (deaktivierte Personen können sich nicht mehr anmelden; alle Daten bleiben erhalten)
          </label>
        ) : null}
      </div>
    </Modal>
  );
}

function ResetModal({ person, onClose }: { person: Profile; onClose: () => void }) {
  const { store } = useApp();
  const { toast } = useUi();
  const [password] = useState(randomPassword());
  const [done, setDone] = useState<'password' | 'mail' | null>(null);
  const run = async (mail: boolean) => {
    try {
      if (mail) await store.sendPasswordReset(person.email);
      else await store.admin('reset_password', { id: person.id, password });
      setDone(mail ? 'mail' : 'password');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };
  return (
    <Modal
      title={`Passwort für ${person.full_name || person.email}`}
      onClose={onClose}
      footer={
        done ? (
          <button type="button" className="btn primary" onClick={onClose}>Fertig</button>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => run(true)}><Mail /> Link per E-Mail</button>
            <button type="button" className="btn primary" onClick={() => run(false)}>Neues Passwort setzen</button>
          </>
        )
      }
    >
      {done === 'password' ? (
        <Field label="Neues Passwort"><CopyField value={password} /></Field>
      ) : done === 'mail' ? (
        <p>Die E-Mail zum Zurücksetzen ist unterwegs an {person.email}.</p>
      ) : (
        <p>Entweder ein neues Passwort setzen (das bisherige funktioniert dann nicht mehr) oder der Person einen Link zum Selbst-Setzen schicken.</p>
      )}
    </Modal>
  );
}

function RemoveModal({ person, onClose }: { person: Profile; onClose: () => void }) {
  const { store, ref } = useApp();
  const save = useSaver();
  const [transfer, setTransfer] = useState('');
  const [mode, setMode] = useState<'deactivate' | 'delete'>('deactivate');
  const others = ref.profiles.filter((p) => p.id !== person.id && p.active);
  const submit = async () => {
    const ok = await save(
      () =>
        mode === 'deactivate'
          ? store.admin('update_user', { id: person.id, active: false })
          : store.admin('delete_user', { id: person.id, transfer_to: transfer || null }),
      mode === 'deactivate' ? 'Zugang deaktiviert.' : 'Person gelöscht.',
    );
    if (ok) onClose();
  };
  return (
    <Modal
      title={`${person.full_name || person.email} entfernen`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn danger" onClick={submit}>{mode === 'deactivate' ? 'Deaktivieren' : 'Endgültig löschen'}</button>
        </>
      }
    >
      <div className="col gap-12">
        <label className="check" style={{ alignItems: 'flex-start' }}>
          <input type="radio" name="rm" checked={mode === 'deactivate'} onChange={() => setMode('deactivate')} style={{ marginTop: 3 }} />
          <span>
            <strong>Deaktivieren (empfohlen)</strong>
            <br />
            <span className="small muted">Anmeldung gesperrt, Anrufe, Notizen und Berichte bleiben mit Namen erhalten. Jederzeit wieder aktivierbar.</span>
          </span>
        </label>
        <label className="check" style={{ alignItems: 'flex-start' }}>
          <input type="radio" name="rm" checked={mode === 'delete'} onChange={() => setMode('delete')} style={{ marginTop: 3 }} />
          <span>
            <strong>Endgültig löschen</strong>
            <br />
            <span className="small muted">Der Zugang wird entfernt. Aktivitäten bleiben, zeigen aber keinen Namen mehr.</span>
          </span>
        </label>
        {mode === 'delete' ? (
          <Field label="Leads und offene Aufgaben übergeben an">
            <select className="select" value={transfer} onChange={(e) => setTransfer(e.target.value)}>
              <option value="">Niemand (Leads ohne Zuständigen)</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
