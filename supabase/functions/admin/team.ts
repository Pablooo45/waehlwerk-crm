// Team verwalten: Zugänge anlegen (Passwort oder Einladung), ändern, sperren, löschen (mit Übergabe).

import { check, type SupabaseRepo } from '../_shared/db.ts';
import { HttpError, isUuid } from '../_shared/http.ts';
import { normalizePhone } from '../_shared/phone.ts';

type Body = Record<string, unknown>;

const FUNCTIONS = ['opener', 'setter', 'closer', 'manager', 'other'];
const COLOR = /^#[0-9a-f]{6}$/i;

async function roleExists(repo: SupabaseRepo, id: string): Promise<boolean> {
  const res = await repo.db.from('roles').select('id').eq('id', id).maybeSingle();
  return !!check(res, 'Rolle');
}

function validEmail(v: unknown): string {
  const email = String(v ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
  return email;
}

export async function createUser(repo: SupabaseRepo, b: Body) {
  const email = validEmail(b.email);
  const fullName = String(b.full_name ?? '').trim() || email.split('@')[0];
  const roleId = String(b.role_id ?? 'user');
  const teamFunction = FUNCTIONS.includes(String(b.team_function)) ? String(b.team_function) : 'opener';
  const color = COLOR.test(String(b.color ?? '')) ? String(b.color) : '#2f6f5e';
  const groupIds = (Array.isArray(b.group_ids) ? b.group_ids : []).filter(isUuid);
  if (!(await roleExists(repo, roleId))) throw new HttpError(400, 'Unbekannte Rolle.');
  const meta = { crm_invited: true, crm_role: roleId, crm_function: teamFunction };

  let userId: string;
  if (b.invite) {
    // Einladung per E-Mail: die Person setzt ihr Passwort selbst
    const redirectTo = typeof b.redirectTo === 'string' && /^https:\/\//.test(b.redirectTo) ? b.redirectTo : undefined;
    const { data, error } = await repo.db.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo });
    if (error || !data.user) throw new HttpError(400, friendlyAuthError(error?.message));
    userId = data.user.id;
    await repo.db.auth.admin.updateUserById(userId, { app_metadata: meta });
  } else {
    const password = String(b.password ?? '');
    if (password.length < 8) throw new HttpError(400, 'Das Passwort braucht mindestens 8 Zeichen.');
    const { data, error } = await repo.db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: meta,
    });
    if (error || !data.user) throw new HttpError(400, friendlyAuthError(error?.message));
    userId = data.user.id;
  }
  check(
    await repo.db.from('profiles').update({ full_name: fullName, role_id: roleId, team_function: teamFunction, color, active: true }).eq('id', userId),
    'Profil',
  );
  if (groupIds.length) {
    check(await repo.db.from('group_members').upsert(groupIds.map((group_id) => ({ group_id, user_id: userId }))), 'Gruppen');
  }
  await repo.log('admin', 'info', `Zugang angelegt: ${email}`, { role: roleId, invite: !!b.invite });
  return { ok: true, id: userId };
}

function friendlyAuthError(msg?: string): string {
  if (/already|registered|exists/i.test(msg ?? '')) return 'Diese E-Mail-Adresse ist schon angelegt.';
  if (/rate|limit/i.test(msg ?? '')) return 'Zu viele E-Mails in kurzer Zeit – bitte später erneut einladen oder ein Passwort setzen.';
  return `Anlegen fehlgeschlagen: ${msg ?? 'unbekannter Fehler'}`;
}

export async function updateUser(repo: SupabaseRepo, b: Body) {
  const id = String(b.id ?? '');
  if (!isUuid(id)) throw new HttpError(400, 'Benutzer unbekannt.');
  const patch: Record<string, unknown> = {};
  if (typeof b.full_name === 'string' && b.full_name.trim()) patch.full_name = b.full_name.trim();
  if (typeof b.role_id === 'string') {
    if (!(await roleExists(repo, b.role_id))) throw new HttpError(400, 'Unbekannte Rolle.');
    patch.role_id = b.role_id;
  }
  if (typeof b.active === 'boolean') patch.active = b.active;
  if (FUNCTIONS.includes(String(b.team_function))) patch.team_function = b.team_function;
  if (typeof b.color === 'string' && COLOR.test(b.color)) patch.color = b.color;
  for (const key of ['phone_number', 'forward_number'] as const) {
    if (b[key] === null || b[key] === '') patch[key] = null;
    else if (typeof b[key] === 'string') {
      const n = normalizePhone(b[key] as string);
      if (!n) throw new HttpError(400, key === 'phone_number' ? 'Absendernummer ungültig.' : 'Weiterleitungsnummer ungültig.');
      patch[key] = n;
    }
  }
  if (['never', 'no_answer', 'always'].includes(String(b.forward_mode))) patch.forward_mode = b.forward_mode;
  if (patch.forward_number === null) patch.forward_mode = 'never';

  if (typeof b.email === 'string') {
    const email = validEmail(b.email);
    const current = check(await repo.db.from('profiles').select('email').eq('id', id).maybeSingle(), 'Profil') as { email: string } | null;
    if (current && current.email !== email) {
      const { error } = await repo.db.auth.admin.updateUserById(id, { email, email_confirm: true });
      if (error) throw new HttpError(400, /already|exists/i.test(error.message) ? 'Diese E-Mail-Adresse ist schon vergeben.' : error.message);
      patch.email = email;
    }
  }
  const { error } = await repo.db.from('profiles').update(patch).eq('id', id);
  if (error) throw new HttpError(400, error.message);
  if (typeof b.active === 'boolean') {
    // gesperrte Zugänge können sich nicht mehr anmelden (bestehende Sitzungen laufen spätestens nach einer Stunde ab)
    const { error: banErr } = await repo.db.auth.admin.updateUserById(id, { ban_duration: b.active ? 'none' : '876000h' });
    if (banErr) await repo.log('admin', 'warn', `Sperre konnte nicht gesetzt werden: ${banErr.message}`, { id });
  }
  return { ok: true };
}

// Löschen: Leads, offene Aufgaben und Opportunities gehen an die gewählte Person (wie in Close)
export async function deleteUser(repo: SupabaseRepo, b: Body, callerId: string) {
  const id = String(b.id ?? '');
  const to = isUuid(b.transfer_to) ? String(b.transfer_to) : null;
  if (!isUuid(id)) throw new HttpError(400, 'Benutzer unbekannt.');
  if (id === callerId) throw new HttpError(400, 'Du kannst dich nicht selbst löschen.');
  if (to === id) throw new HttpError(400, 'Bitte eine andere Person für die Übergabe wählen.');
  const person = check(await repo.db.from('profiles').select('id, role_id, active, email').eq('id', id).maybeSingle(), 'Profil') as
    | { id: string; role_id: string; active: boolean; email: string }
    | null;
  if (!person) throw new HttpError(404, 'Benutzer unbekannt.');
  if (person.role_id === 'admin') {
    const others = check(await repo.db.from('profiles').select('id').eq('role_id', 'admin').eq('active', true).neq('id', id), 'Admins') as unknown[];
    if (!others.length) throw new HttpError(400, 'Es muss mindestens ein aktiver Admin bleiben.');
  }
  const moved: Record<string, number> = {};
  const run = async (label: string, q: PromiseLike<{ error: { message: string } | null; count: number | null }>) => {
    const res = await q;
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
    moved[label] = res.count ?? 0;
  };
  await run('leads', repo.db.from('leads').update({ owner_id: to }, { count: 'exact' }).eq('owner_id', id));
  await run('leads_opener', repo.db.from('leads').update({ opener_id: to }, { count: 'exact' }).eq('opener_id', id));
  await run('tasks', repo.db.from('tasks').update({ assigned_to: to }, { count: 'exact' }).eq('assigned_to', id).eq('done', false));
  await run('opportunities', repo.db.from('opportunities').update({ user_id: to }, { count: 'exact' }).eq('user_id', id));
  await run('workflows', repo.db.from('workflows').update({ sender_user: to }, { count: 'exact' }).eq('sender_user', id));
  const { error } = await repo.db.auth.admin.deleteUser(id);
  if (error) throw new HttpError(400, `Löschen fehlgeschlagen: ${error.message}`);
  await repo.log('admin', 'info', `Zugang gelöscht: ${person.email}`, { transferTo: to, moved });
  return { ok: true, moved };
}

export async function resetPassword(repo: SupabaseRepo, b: Body) {
  const id = String(b.id ?? '');
  const password = String(b.password ?? '');
  if (!isUuid(id)) throw new HttpError(400, 'Benutzer unbekannt.');
  if (password.length < 8) throw new HttpError(400, 'Das Passwort braucht mindestens 8 Zeichen.');
  const { error } = await repo.db.auth.admin.updateUserById(id, { password });
  if (error) throw new HttpError(400, error.message);
  return { ok: true };
}
