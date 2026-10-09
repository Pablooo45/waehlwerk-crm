// Twilio verbinden und einrichten: API-Schlüssel fürs Browser-Telefon, TwiML-App, Nummern.

import { hookUrl, type SupabaseRepo } from '../_shared/db.ts';
import { HttpError } from '../_shared/http.ts';
import { twilioFromRepo } from '../_shared/telephony.ts';
import { TwilioClient, TwilioError } from '../_shared/twilio.ts';

export async function twilioConnect(repo: SupabaseRepo, accountSid: string, authToken: string) {
  accountSid = accountSid.trim();
  authToken = authToken.trim();
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) throw new HttpError(400, 'Die Account SID beginnt mit "AC" und hat 34 Zeichen.');
  if (!/^[0-9a-f]{32}$/i.test(authToken)) throw new HttpError(400, 'Der Auth Token hat 32 Zeichen (Ziffern und a–f).');
  const twilio = new TwilioClient(accountSid, authToken);
  await twilio.request('GET', '.json'); // prüft die Zugangsdaten
  const previous = await repo.secret('TWILIO_ACCOUNT_SID');
  await repo.setSecret('TWILIO_ACCOUNT_SID', accountSid);
  await repo.setSecret('TWILIO_AUTH_TOKEN', authToken);
  if (previous && previous !== accountSid) {
    // anderes Konto → Schlüssel und App neu anlegen
    await repo.setSecret('TWILIO_API_KEY_SID', '');
    await repo.setSecret('TWILIO_API_KEY_SECRET', '');
    await repo.setSecret('TWILIO_TWIML_APP_SID', '');
  }
  return twilioSetup(repo);
}

export function voiceAppParams() {
  return {
    FriendlyName: 'CRM Telefon',
    VoiceUrl: hookUrl('twilio-voice'),
    VoiceMethod: 'POST',
    StatusCallback: hookUrl('twilio-status', { type: 'parent' }),
    StatusCallbackMethod: 'POST',
  };
}

export async function twilioSetup(repo: SupabaseRepo) {
  const twilio = await twilioFromRepo(repo);
  const account = await twilio.request<{ friendly_name: string; status: string; type: string }>('GET', '.json');
  const warnings: string[] = [];
  if (account.type === 'Trial') {
    warnings.push('Twilio-Testkonto: Du kannst nur bestätigte Nummern anrufen und Anrufer hören einen Hinweis. Für den echten Betrieb das Konto upgraden.');
  }

  // 1) API-Schlüssel fürs Browser-Telefon
  let keySid = await repo.secret('TWILIO_API_KEY_SID');
  let keySecret = await repo.secret('TWILIO_API_KEY_SECRET');
  if (keySid) {
    try {
      await twilio.request('GET', `/Keys/${keySid}.json`);
    } catch (e) {
      if (e instanceof TwilioError && e.status === 404) keySid = null;
      else throw e;
    }
  }
  let keyCreated = false;
  if (!keySid || !keySecret) {
    const k = await twilio.request<{ sid: string; secret: string }>('POST', '/Keys.json', { FriendlyName: 'CRM Browser-Telefon' });
    keySid = k.sid;
    keySecret = k.secret;
    await repo.setSecret('TWILIO_API_KEY_SID', keySid);
    await repo.setSecret('TWILIO_API_KEY_SECRET', keySecret);
    keyCreated = true;
  }

  // 2) TwiML-App: sagt Twilio, wohin es bei Anrufen fragen soll (Frankfurt, nahe der Datenbank)
  const appParams = voiceAppParams();
  let appSid = await repo.secret('TWILIO_TWIML_APP_SID');
  if (appSid) {
    try {
      await twilio.request('POST', `/Applications/${appSid}.json`, appParams);
    } catch (e) {
      if (e instanceof TwilioError && e.status === 404) appSid = null;
      else throw e;
    }
  }
  if (!appSid) {
    const app = await twilio.request<{ sid: string }>('POST', '/Applications.json', appParams);
    appSid = app.sid;
    await repo.setSecret('TWILIO_TWIML_APP_SID', appSid);
  }

  // 3) Nummern auf das CRM umstellen (Anrufe und SMS)
  const synced = await syncNumbers(repo, twilio, appSid, warnings);

  // 4) Bestätigte eigene Nummern (z. B. Festnetz der Firma) als Absender
  const ids = await twilio.request<{ outgoing_caller_ids: { phone_number: string; friendly_name: string }[] }>(
    'GET',
    '/OutgoingCallerIds.json',
    { PageSize: 100 },
  );
  const callerIds = [
    ...synced.map((n) => ({ number: n.number, label: n.label, kind: 'twilio' })),
    ...(ids.outgoing_caller_ids ?? []).map((c) => ({ number: c.phone_number, label: c.friendly_name, kind: 'verified' })),
  ];
  const org = await repo.org();
  if (!org.default_caller_id && callerIds.length) await repo.updateOrg({ default_caller_id: callerIds[0].number });
  if (!synced.length) warnings.push('Noch keine Twilio-Nummer: Für eingehende Anrufe eine deutsche Nummer kaufen (Twilio → Phone Numbers).');
  if (!callerIds.length) {
    warnings.push('Keine Absendernummer: Entweder eine Twilio-Nummer kaufen oder eure Firmennummer bei Twilio bestätigen (Verified Caller IDs).');
  }

  await repo.log('admin', 'info', 'Twilio eingerichtet', { appSid, numbers: synced.length, keyCreated });
  return {
    ok: true,
    account: { name: account.friendly_name, status: account.status, type: account.type },
    appSid,
    numbers: synced,
    callerIds,
    warnings,
  };
}

interface TwNumber {
  sid: string;
  phone_number: string;
  friendly_name: string;
  voice_application_sid: string | null;
  sms_url: string | null;
  capabilities?: { voice?: boolean; sms?: boolean };
}

export async function syncNumbers(repo: SupabaseRepo, twilio: TwilioClient, appSid: string, warnings: string[] = []) {
  const nums = await twilio.request<{ incoming_phone_numbers: TwNumber[] }>('GET', '/IncomingPhoneNumbers.json', { PageSize: 200 });
  const list = nums.incoming_phone_numbers ?? [];
  const smsUrl = hookUrl('twilio-sms');
  for (const n of list) {
    const update: Record<string, string> = {};
    if (n.voice_application_sid !== appSid) update.VoiceApplicationSid = appSid;
    if (n.capabilities?.sms && n.sms_url !== smsUrl) {
      update.SmsUrl = smsUrl;
      update.SmsMethod = 'POST';
    }
    if (Object.keys(update).length) {
      try {
        await twilio.request('POST', `/IncomingPhoneNumbers/${n.sid}.json`, update);
      } catch (e) {
        warnings.push(`${n.phone_number}: ${e instanceof Error ? e.message : e}`);
      }
    }
    // Einstellungen der Nummer (wer klingelt, Rufzeiten …) bleiben erhalten
    const { error } = await repo.db.from('phone_numbers').upsert(
      { number: n.phone_number, label: n.friendly_name, twilio_sid: n.sid, sms_capable: !!n.capabilities?.sms },
      { onConflict: 'number' },
    );
    if (error) throw new Error(`Nummer speichern: ${error.message}`);
  }
  const keep = new Set(list.map((n) => n.phone_number));
  const { data: stored } = await repo.db.from('phone_numbers').select('number');
  for (const row of (stored ?? []) as { number: string }[]) {
    if (!keep.has(row.number)) await repo.db.from('phone_numbers').delete().eq('number', row.number);
  }
  return list.map((n) => ({ number: n.phone_number, label: n.friendly_name, sms: !!n.capabilities?.sms }));
}

export async function twilioSyncNumbers(repo: SupabaseRepo) {
  const twilio = await twilioFromRepo(repo);
  const appSid = await repo.secret('TWILIO_TWIML_APP_SID');
  if (!appSid) throw new HttpError(409, 'Twilio ist noch nicht eingerichtet (Einstellungen → Telefonie → Verbinden).');
  const warnings: string[] = [];
  const numbers = await syncNumbers(repo, twilio, appSid, warnings);
  return { ok: true, numbers, warnings };
}
