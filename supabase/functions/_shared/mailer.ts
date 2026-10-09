// E-Mails aus dem CRM senden (über das eigene Postfach) und Antworten abholen.
// Gesendete Mails landen auch im „Gesendet“-Ordner, damit das Postfach vollständig bleibt.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { check, type Repo } from './db.ts';
import { findSentFolder, ImapClient } from './imap.ts';
import { buildMime, htmlToText, type MailAddress, parseAddressList, parseMime, stripQuoted, textToHtml } from './mime.ts';
import { smtpSend } from './smtp.ts';

export interface MailAccount {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
  signature: string;
  sync_enabled: boolean;
  sync_folder: string;
  sent_folder: string | null;
  sync_state: Record<string, { validity: number | null; uid: number }>;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface EmailRow {
  id: string;
  lead_id: string;
  contact_id: string | null;
  user_id: string | null;
  account_id: string | null;
  direction: 'outbound' | 'inbound';
  status: string;
  to_address: string | null;
  cc: string | null;
  bcc: string | null;
  subject: string;
  body: string;
  is_html: boolean;
  attachments: { name: string; size: number; path: string }[];
  in_reply_to: string | null;
  message_id: string | null;
  template_id: string | null;
  workflow_run_id: string | null;
}

export interface MailEnv {
  db: SupabaseClient;
  repo: Repo;
  caCerts?: string[]; // nur für Tests
}

export const pwKey = (accountId: string) => `email_pw:${accountId}`;

export async function accountPassword(repo: Repo, accountId: string): Promise<string> {
  const pw = await repo.secret(pwKey(accountId));
  if (!pw) throw new Error('Passwort des Postfachs fehlt – bitte unter Einstellungen → E-Mail neu eintragen.');
  return pw;
}

export async function loadAccount(db: SupabaseClient, id: string): Promise<MailAccount | null> {
  return check(await db.from('email_accounts').select('*').eq('id', id).maybeSingle(), 'Postfach') as MailAccount | null;
}

export async function accountOf(db: SupabaseClient, userId: string): Promise<MailAccount | null> {
  const res = await db.from('email_accounts').select('*').eq('user_id', userId).order('created_at').limit(1);
  return ((check(res, 'Postfach') as MailAccount[]) ?? [])[0] ?? null;
}

function domainOf(email: string): string {
  return email.split('@')[1] || 'crm.local';
}

function signatureBlock(account: MailAccount, html: boolean): string {
  const sig = (account.signature ?? '').trim();
  if (!sig) return '';
  const isHtmlSig = /<[a-z][\s\S]*>/i.test(sig);
  if (html) return `<br><div class="signature">${isHtmlSig ? sig : textToHtml(sig)}</div>`;
  return `\n\n-- \n${isHtmlSig ? htmlToText(sig) : sig}`;
}

// Eine E-Mail aus der Tabelle versenden (sofort oder vom Zeitplan) – Status wird gespeichert
export async function sendEmailRow(env: MailEnv, emailId: string): Promise<{ ok: boolean; error?: string }> {
  const { db, repo } = env;
  const email = check(await db.from('emails').select('*').eq('id', emailId).maybeSingle(), 'E-Mail') as EmailRow | null;
  if (!email) return { ok: false, error: 'E-Mail nicht gefunden.' };
  if (email.status === 'sent') return { ok: true };
  const fail = async (msg: string) => {
    await db.from('emails').update({ status: 'failed', error: msg.slice(0, 500) }).eq('id', emailId);
    if (email.user_id) {
      await repo.notify(email.user_id, 'email', email.lead_id, 'email', email.id, 'E-Mail nicht gesendet', `${email.subject}: ${msg}`);
    }
    return { ok: false, error: msg };
  };
  try {
    const account = email.account_id ? await loadAccount(db, email.account_id) : email.user_id ? await accountOf(db, email.user_id) : null;
    if (!account) return await fail('Kein Postfach verbunden (Einstellungen → E-Mail).');
    await db.from('emails').update({ status: 'sending', account_id: account.id, from_address: account.email }).eq('id', emailId);
    const password = await accountPassword(repo, account.id);
    const to = parseAddressList(email.to_address ?? '');
    const cc = parseAddressList(email.cc ?? '');
    const bcc = parseAddressList(email.bcc ?? '');
    if (!to.length) return await fail('Keine gültige Empfängeradresse.');

    const attachments: { name: string; contentType: string; data: Uint8Array }[] = [];
    let total = 0;
    for (const a of email.attachments ?? []) {
      const { data, error } = await db.storage.from('attachments').download(a.path);
      if (error || !data) return await fail(`Anhang „${a.name}“ nicht gefunden.`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      total += bytes.length;
      if (total > 20 * 1024 * 1024) return await fail('Anhänge sind zusammen größer als 20 MB.');
      attachments.push({ name: a.name, contentType: data.type || 'application/octet-stream', data: bytes });
    }

    const html = email.is_html ? email.body + signatureBlock(account, true) : null;
    const text = email.is_html ? htmlToText(html!) : email.body + signatureBlock(account, false);
    const messageId = `${email.id}@${domainOf(account.email)}`;
    const from: MailAddress = { email: account.email, name: account.display_name || null };
    const message = buildMime({
      from,
      to,
      cc,
      subject: email.subject,
      html,
      text,
      attachments,
      messageId,
      inReplyTo: email.in_reply_to,
    });
    await smtpSend(
      { host: account.smtp_host, port: account.smtp_port, username: account.username, password, caCerts: env.caCerts, helo: domainOf(account.email) },
      account.email,
      [...to, ...cc, ...bcc].map((a) => a.email),
      message,
    );
    await db.from('emails').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      message_id: messageId,
      thread_key: email.in_reply_to ?? messageId,
      error: null,
    }).eq('id', emailId);

    // Kopie im „Gesendet“-Ordner (nicht kritisch)
    try {
      await appendSent(env, account, password, message);
    } catch (e) {
      await repo.log('email', 'warn', `Kopie im Gesendet-Ordner fehlgeschlagen: ${e instanceof Error ? e.message : e}`, { account: account.id });
    }
    return { ok: true };
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }
}

async function appendSent(env: MailEnv, account: MailAccount, password: string, message: string) {
  const imap = await ImapClient.connect({ host: account.imap_host, port: account.imap_port, username: account.username, password, caCerts: env.caCerts });
  try {
    await imap.login(account.username, password);
    let folder = account.sent_folder;
    if (!folder) {
      folder = findSentFolder(await imap.list());
      if (folder) await env.db.from('email_accounts').update({ sent_folder: folder }).eq('id', account.id);
    }
    if (folder) await imap.append(folder, message);
  } finally {
    await imap.logout();
  }
}

// ---------------------------------------------------------------------------
// Abruf: neue Mails von/an bekannte Kontakte dem Lead zuordnen
// ---------------------------------------------------------------------------
export interface SyncResult {
  checked: number;
  imported: number;
}

function imapSince(d: Date): string {
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()}-${m[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

export async function syncAccount(env: MailEnv, account: MailAccount, opts: { maxMessages?: number; firstDays?: number } = {}): Promise<SyncResult> {
  const { db, repo } = env;
  const max = opts.maxMessages ?? 40;
  const password = await accountPassword(repo, account.id);
  const imap = await ImapClient.connect({ host: account.imap_host, port: account.imap_port, username: account.username, password, caCerts: env.caCerts });
  const state = { ...(account.sync_state ?? {}) };
  const result: SyncResult = { checked: 0, imported: 0 };
  try {
    await imap.login(account.username, password);
    let sent = account.sent_folder;
    if (!sent) {
      sent = findSentFolder(await imap.list());
      if (sent) await db.from('email_accounts').update({ sent_folder: sent }).eq('id', account.id);
    }
    const folders: { name: string; outgoing: boolean }[] = [{ name: account.sync_folder || 'INBOX', outgoing: false }];
    if (sent) folders.push({ name: sent, outgoing: true });

    for (const f of folders) {
      const box = await imap.select(f.name);
      const prev = state[f.name];
      let uids: number[];
      if (!prev || (prev.validity && box.uidValidity && prev.validity !== box.uidValidity)) {
        // Erster Abruf: nur die letzten Tage, nicht das ganze Postfach
        const since = new Date(Date.now() - (opts.firstDays ?? 7) * 86_400_000);
        uids = (await imap.uidSearch(`SINCE ${imapSince(since)}`)).slice(-200);
        state[f.name] = { validity: box.uidValidity, uid: 0 };
      } else {
        uids = (await imap.uidSearch(`UID ${prev.uid + 1}:*`)).filter((u) => u > prev.uid);
      }
      const todo = uids.slice(0, max);
      for (let i = 0; i < todo.length; i += 10) {
        const batch = await imap.fetchMessages(todo.slice(i, i + 10));
        for (const m of batch) {
          result.checked++;
          if (await importMessage(env, account, m.raw, f.outgoing)) result.imported++;
          state[f.name] = { validity: box.uidValidity, uid: Math.max(state[f.name]?.uid ?? 0, m.uid) };
        }
      }
      if (!todo.length && box.uidNext) state[f.name] = { validity: box.uidValidity, uid: Math.max(state[f.name]?.uid ?? 0, box.uidNext - 1) };
    }
    await db.from('email_accounts').update({ sync_state: state, last_sync_at: new Date().toISOString(), last_error: null }).eq('id', account.id);
    return result;
  } catch (e) {
    await db.from('email_accounts').update({ sync_state: state, last_error: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
      .eq('id', account.id);
    throw e;
  } finally {
    await imap.logout();
  }
}

async function importMessage(env: MailEnv, account: MailAccount, raw: string, outgoing: boolean): Promise<boolean> {
  const { db, repo } = env;
  const mail = parseMime(raw);
  if (!mail.from) return false;
  const messageId = mail.messageId ?? `${account.id}-${mail.date?.getTime() ?? Date.now()}-${mail.subject.slice(0, 20)}`;
  // Eigene, über das CRM gesendete Mails liegen schon vor
  const dupe = await db.from('emails').select('id').eq('message_id', messageId).limit(1);
  if ((dupe.data ?? []).length) return false;

  // Wem gehört die Mail? Eingehend: Absender; Gesendet: erster bekannter Empfänger
  const candidates = outgoing ? [...mail.to, ...mail.cc].map((a) => a.email) : [mail.from.email];
  let match = null;
  for (const c of candidates) {
    if (c === account.email.toLowerCase()) continue;
    match = await repo.findByEmail(c);
    if (match) break;
  }
  // Antwort auf eine CRM-Mail an eine noch unbekannte Adresse → über die Nachrichten-ID zuordnen
  if (!match && mail.inReplyTo) {
    const parent = await db.from('emails').select('lead_id, contact_id').eq('message_id', mail.inReplyTo).limit(1);
    const p = (parent.data ?? [])[0] as { lead_id: string; contact_id: string | null } | undefined;
    if (p) match = { lead_id: p.lead_id, contact_id: p.contact_id ?? '', contact_name: '', lead_name: '', owner_id: null };
  }
  if (!match) return false;

  const body = mail.html ?? mail.text;
  const row = {
    lead_id: match.lead_id,
    contact_id: match.contact_id || null,
    user_id: account.user_id,
    account_id: account.id,
    direction: outgoing ? 'outbound' : 'inbound',
    status: outgoing ? 'sent' : 'received',
    from_address: mail.from.email,
    to_address: mail.to.map((a) => a.email).join(', '),
    cc: mail.cc.map((a) => a.email).join(', ') || null,
    subject: mail.subject || '(ohne Betreff)',
    body: body.slice(0, 200_000),
    is_html: !!mail.html,
    attachments: mail.attachments.map((a) => ({ name: a.name, size: a.size, path: '' })),
    message_id: messageId,
    in_reply_to: mail.inReplyTo,
    thread_key: mail.references[0] ?? mail.inReplyTo ?? messageId,
    sent_at: (mail.date ?? new Date()).toISOString(),
    auto_reply: mail.autoReply,
  };
  const ins = await db.from('emails').insert(row).select('id').single();
  if (ins.error) {
    if (ins.error.code === '23505') return false;
    throw new Error(`E-Mail speichern: ${ins.error.message}`);
  }
  if (!outgoing) {
    const lead = await repo.lead(match.lead_id);
    const preview = stripQuoted(mail.text).slice(0, 200);
    const who = lead?.owner_id ?? account.user_id;
    await repo.notify(who, 'email', match.lead_id, 'email', (ins.data as { id: string }).id, `${mail.autoReply ? 'Abwesenheitsnotiz' : 'Antwort'} von ${lead?.name ?? mail.from.email}`, preview);
  }
  return true;
}
