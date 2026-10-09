// E-Mail aus dem CRM: Postfach verbinden/prüfen, senden (sofort oder geplant), Sammel-E-Mails, Abruf.

import { check, type Caller, requireUser, SupabaseRepo } from '../_shared/db.ts';
import { errorResponse, HttpError, isUuid, json, preflight, readJson } from '../_shared/http.ts';
import { ImapClient } from '../_shared/imap.ts';
import { accountPassword, loadAccount, type MailAccount, pwKey, sendEmailRow, syncAccount } from '../_shared/mailer.ts';
import { smtpCheck } from '../_shared/smtp.ts';
import { fillTemplate, templateVars } from '../_shared/template.ts';

type Body = Record<string, unknown> & { action?: string };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const repo = new SupabaseRepo();
  let action = '';
  try {
    const user = await requireUser(req, repo);
    const body = await readJson<Body>(req);
    action = String(body.action ?? '');
    switch (action) {
      case 'account_test':
        return json(await accountTest(repo, user, body));
      case 'account_save':
        return json(await accountSave(repo, user, body));
      case 'account_delete':
        return json(await accountDelete(repo, user, body));
      case 'account_sync':
        return json(await accountSyncNow(repo, user, body));
      case 'send':
        return json(await send(repo, user, body));
      case 'bulk':
        return json(await bulk(repo, user, body));
      default:
        throw new HttpError(400, `Unbekannte Aktion: ${action}`);
    }
  } catch (e) {
    if (!(e instanceof HttpError)) await repo.log('email', 'error', `${action}: ${e instanceof Error ? e.message : e}`);
    return errorResponse(e instanceof HttpError ? e : new HttpError(400, e instanceof Error ? e.message : String(e)));
  }
});

// ---------------------------------------------------------------------------
// Postfach
// ---------------------------------------------------------------------------
interface AccountInput {
  email: string;
  display_name: string;
  username: string;
  password: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
}

function host(v: unknown, what: string): string {
  const h = String(v ?? '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) throw new HttpError(400, `${what}: Servername ungültig.`);
  return h;
}

function port(v: unknown, fallback: number): number {
  const n = Number(v ?? fallback);
  if (n === 587 || n === 25) throw new HttpError(400, 'Port 587/25 ist auf dem Server gesperrt – bitte 465 (SSL/TLS) verwenden.');
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new HttpError(400, 'Port ungültig.');
  return n;
}

async function ownAccount(repo: SupabaseRepo, user: Caller, id: unknown): Promise<MailAccount> {
  if (!isUuid(id)) throw new HttpError(400, 'Postfach unbekannt.');
  const acc = await loadAccount(repo.db, id);
  if (!acc || (acc.user_id !== user.id && !user.isAdmin)) throw new HttpError(404, 'Postfach nicht gefunden.');
  return acc;
}

async function readInput(repo: SupabaseRepo, user: Caller, b: Body): Promise<AccountInput> {
  const email = String(b.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
  let password = String(b.password ?? '');
  if (!password && isUuid(b.id)) password = await accountPassword(repo, (await ownAccount(repo, user, b.id)).id);
  if (!password) throw new HttpError(400, 'Bitte das Passwort des Postfachs eingeben.');
  return {
    email,
    display_name: String(b.display_name ?? '').trim(),
    username: String(b.username ?? email).trim() || email,
    password,
    imap_host: host(b.imap_host, 'Posteingang'),
    imap_port: port(b.imap_port, 993),
    smtp_host: host(b.smtp_host, 'Postausgang'),
    smtp_port: port(b.smtp_port, 465),
  };
}

async function testConnection(a: AccountInput): Promise<{ imap: string; smtp: string }> {
  const imap = await ImapClient.connect({ host: a.imap_host, port: a.imap_port, username: a.username, password: a.password });
  let inbox: string;
  try {
    await imap.login(a.username, a.password);
    const box = await imap.select('INBOX');
    inbox = `verbunden, ${box.exists} Nachrichten im Posteingang`;
  } finally {
    await imap.logout();
  }
  await smtpCheck({ host: a.smtp_host, port: a.smtp_port, username: a.username, password: a.password });
  return { imap: inbox, smtp: 'Anmeldung erfolgreich' };
}

async function accountTest(repo: SupabaseRepo, user: Caller, b: Body) {
  return await testConnection(await readInput(repo, user, b));
}

async function accountSave(repo: SupabaseRepo, user: Caller, b: Body) {
  // Nur Einstellungen ändern (Signatur, Abruf an/aus) – ohne neue Zugangsdaten
  if (isUuid(b.id) && !b.password && !b.imap_host) {
    const acc = await ownAccount(repo, user, b.id);
    const patch: Record<string, unknown> = {};
    if (typeof b.signature === 'string') patch.signature = b.signature.slice(0, 20_000);
    if (typeof b.sync_enabled === 'boolean') patch.sync_enabled = b.sync_enabled;
    if (typeof b.display_name === 'string') patch.display_name = b.display_name.trim();
    const saved = check(await repo.db.from('email_accounts').update(patch).eq('id', acc.id).select('*').single(), 'Postfach');
    return { account: strip(saved as MailAccount) };
  }
  const input = await readInput(repo, user, b);
  await testConnection(input); // nur funktionierende Zugangsdaten speichern
  const row = {
    user_id: user.id,
    email: input.email,
    display_name: input.display_name || user.full_name,
    username: input.username,
    imap_host: input.imap_host,
    imap_port: input.imap_port,
    smtp_host: input.smtp_host,
    smtp_port: input.smtp_port,
    last_error: null,
    ...(typeof b.signature === 'string' ? { signature: b.signature } : {}),
  };
  let saved: MailAccount;
  if (isUuid(b.id)) {
    const acc = await ownAccount(repo, user, b.id);
    saved = check(await repo.db.from('email_accounts').update({ ...row, user_id: acc.user_id }).eq('id', acc.id).select('*').single(), 'Postfach') as MailAccount;
  } else {
    const res = await repo.db.from('email_accounts').upsert(row, { onConflict: 'user_id,email' }).select('*').single();
    saved = check(res, 'Postfach') as MailAccount;
  }
  await repo.setSecret(pwKey(saved.id), input.password);
  return { account: strip(saved) };
}

function strip(a: MailAccount) {
  const { sync_state: _s, ...rest } = a;
  return rest;
}

async function accountDelete(repo: SupabaseRepo, user: Caller, b: Body) {
  const acc = await ownAccount(repo, user, b.id);
  check(await repo.db.from('email_accounts').delete().eq('id', acc.id), 'Postfach');
  await repo.setSecret(pwKey(acc.id), '');
  return { ok: true };
}

async function accountSyncNow(repo: SupabaseRepo, user: Caller, b: Body) {
  const acc = await ownAccount(repo, user, b.id);
  const r = await syncAccount({ db: repo.db, repo }, acc, { maxMessages: 60 });
  return { ok: true, ...r };
}

// ---------------------------------------------------------------------------
// Senden
// ---------------------------------------------------------------------------
async function canSeeLead(repo: SupabaseRepo, userId: string, leadId: string): Promise<boolean> {
  const res = await repo.db.rpc('user_can_see_lead', { p_user: userId, p_lead: leadId });
  return !!check(res, 'Lead');
}

function addresses(v: unknown, max = 50): string {
  const list = String(v ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  for (const a of list) {
    if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(a.replace(/^.*<|>$/g, ''))) throw new HttpError(400, `Ungültige Adresse: ${a}`);
  }
  if (list.length > max) throw new HttpError(400, `Höchstens ${max} Empfänger.`);
  return list.join(', ');
}

async function send(repo: SupabaseRepo, user: Caller, b: Body) {
  const leadId = String(b.lead_id ?? '');
  if (!isUuid(leadId) || !(await canSeeLead(repo, user.id, leadId))) throw new HttpError(404, 'Lead nicht gefunden.');
  const to = addresses(b.to);
  if (!to) throw new HttpError(400, 'Bitte einen Empfänger angeben.');
  const subject = String(b.subject ?? '').trim();
  const body = String(b.body ?? '');
  if (!subject && !body.trim()) throw new HttpError(400, 'Betreff und Text fehlen.');
  const attachments = (Array.isArray(b.attachments) ? b.attachments : []) as { name: string; size: number; path: string }[];
  for (const a of attachments) {
    // nur eigene hochgeladene Anhänge (Ordner = eigene Nutzer-ID)
    if (typeof a?.path !== 'string' || !a.path.startsWith(`${user.id}/`)) throw new HttpError(400, 'Ungültiger Anhang.');
  }
  let accountId = isUuid(b.account_id) ? String(b.account_id) : null;
  if (accountId) await ownAccount(repo, user, accountId);
  else {
    const res = await repo.db.from('email_accounts').select('id').eq('user_id', user.id).order('created_at').limit(1);
    accountId = ((check(res, 'Postfach') as { id: string }[])[0])?.id ?? null;
  }
  if (!accountId) throw new HttpError(409, 'Bitte zuerst dein Postfach verbinden (Einstellungen → E-Mail).');
  const sendAt = typeof b.send_at === 'string' && Date.parse(b.send_at) > Date.now() + 30_000 ? new Date(b.send_at).toISOString() : null;
  const row = {
    lead_id: leadId,
    contact_id: isUuid(b.contact_id) ? b.contact_id : null,
    user_id: user.id,
    account_id: accountId,
    direction: 'outbound',
    status: sendAt ? 'scheduled' : 'sending',
    to_address: to,
    cc: b.cc ? addresses(b.cc) : null,
    bcc: b.bcc ? addresses(b.bcc) : null,
    subject: subject || '(ohne Betreff)',
    body,
    is_html: !!b.is_html,
    attachments,
    template_id: isUuid(b.template_id) ? b.template_id : null,
    in_reply_to: typeof b.in_reply_to === 'string' ? b.in_reply_to : null,
    send_at: sendAt,
  };
  const ins = check(await repo.db.from('emails').insert(row).select('*').single(), 'E-Mail') as { id: string };
  if (!sendAt) await sendEmailRow({ db: repo.db, repo }, ins.id);
  const email = check(await repo.db.from('emails').select('*').eq('id', ins.id).single(), 'E-Mail');
  return { email };
}

// Sammel-E-Mail: je Lead an den ersten Kontakt mit E-Mail-Adresse, gestaffelt versendet (Zeitplan)
async function bulk(repo: SupabaseRepo, user: Caller, b: Body) {
  if (!user.can('bulk_email')) throw new HttpError(403, 'Für Sammel-E-Mails fehlt dir das Recht.');
  const ids = (Array.isArray(b.leadIds) ? b.leadIds : []).filter(isUuid) as string[];
  if (!ids.length) throw new HttpError(400, 'Keine Leads ausgewählt.');
  if (ids.length > 2000) throw new HttpError(400, 'Höchstens 2.000 Leads auf einmal.');
  if (!isUuid(b.templateId)) throw new HttpError(400, 'Bitte eine Vorlage wählen.');
  const tpl = check(await repo.db.from('email_templates').select('*').eq('id', b.templateId).maybeSingle(), 'Vorlage') as
    | { id: string; subject: string; body: string; is_html: boolean; kind: string; shared: boolean; created_by: string | null }
    | null;
  if (!tpl || tpl.kind !== 'email' || (!tpl.shared && tpl.created_by !== user.id)) throw new HttpError(404, 'Vorlage nicht gefunden.');
  const accRes = await repo.db.from('email_accounts').select('id').eq('user_id', user.id).order('created_at').limit(1);
  const accountId = ((check(accRes, 'Postfach') as { id: string }[])[0])?.id;
  if (!accountId) throw new HttpError(409, 'Bitte zuerst dein Postfach verbinden (Einstellungen → E-Mail).');
  const org = await repo.org();
  const start = typeof b.sendAt === 'string' && Date.parse(b.sendAt) > Date.now() ? Date.parse(b.sendAt) : Date.now();

  let queued = 0;
  let skipped = 0;
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const visible = new Set(check(await repo.db.rpc('user_visible_leads', { p_user: user.id, p_leads: part }), 'Leads') as string[]);
    const leads = check(
      await repo.db.from('leads').select('id, name, address_city, do_not_call, contacts(id, name, emails, sort)').in('id', part),
      'Leads',
    ) as { id: string; name: string; address_city: string | null; contacts: { id: string; name: string; emails: { email: string }[]; sort: number }[] }[];
    for (const lead of leads) {
      if (!visible.has(lead.id)) {
        skipped++;
        continue;
      }
      const contact = [...(lead.contacts ?? [])].sort((a, c) => a.sort - c.sort).find((c) => c.emails?.[0]?.email);
      if (!contact) {
        skipped++;
        continue;
      }
      const vars = templateVars(lead, contact, user, org.name);
      rows.push({
        lead_id: lead.id,
        contact_id: contact.id,
        user_id: user.id,
        account_id: accountId,
        direction: 'outbound',
        status: 'scheduled',
        to_address: contact.emails[0].email,
        subject: fillTemplate(tpl.subject, vars),
        body: fillTemplate(tpl.body, vars),
        is_html: tpl.is_html,
        template_id: tpl.id,
        // gestaffelt (alle 20 Sekunden eine), damit der Mailserver nicht drosselt
        send_at: new Date(start + queued * 20_000).toISOString(),
      });
      queued++;
    }
    skipped += part.length - leads.length;
  }
  for (let i = 0; i < rows.length; i += 500) check(await repo.db.from('emails').insert(rows.slice(i, i + 500)), 'E-Mails');
  await repo.log('email', 'info', `Sammel-E-Mail geplant: ${queued} Empfänger`, { template: tpl.id, user: user.id });
  return { queued, skipped };
}
