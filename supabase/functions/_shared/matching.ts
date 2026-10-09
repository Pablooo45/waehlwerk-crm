// Termine (Calendly / Google) dem richtigen Lead zuordnen.

import type { Repo } from './db.ts';
import { isUuid } from './http.ts';
import { normalizePhone } from './phone.ts';

export function extractPhones(texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/(\+?\d[\d\s/().-]{5,}\d)/g)) {
      const digits = m[1].replace(/\D/g, '');
      if (digits.length < 7) continue;
      const n = normalizePhone(m[1]);
      if (n && n.length >= 10) out.add(n);
    }
  }
  return [...out];
}

export function extractEmails(texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) out.add(m[0].toLowerCase());
  }
  return [...out];
}

// Vom CRM angelegte Termine enthalten "#/leads/<id>" oder "CRM-Lead-ID: <id>"
export function extractLeadId(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/(?:#\/leads\/|CRM-Lead-ID:\s*)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}

const COMPANY_QUESTION = /(apotheke|firma|unternehmen|company|praxis|betrieb|geschäft|name der)/i;

export function companyFromAnswers(qa: { question: string; answer: string }[] | undefined | null): string | null {
  for (const item of qa ?? []) {
    if (COMPANY_QUESTION.test(item.question) && item.answer && item.answer.trim().length > 1) {
      return item.answer.trim().slice(0, 200);
    }
  }
  return null;
}

export interface MatchInput {
  leadId?: string | null;
  emails?: string[];
  phones?: string[];
  companyName?: string | null;
}

export interface MatchResult {
  lead_id: string;
  contact_id: string | null;
  how: 'id' | 'email' | 'phone' | 'name';
}

export async function matchLead(repo: Repo, input: MatchInput): Promise<MatchResult | null> {
  if (input.leadId && isUuid(input.leadId)) {
    const lead = await repo.lead(input.leadId);
    if (lead) {
      // passenden Kontakt dazu suchen
      for (const e of input.emails ?? []) {
        const m = await repo.findByEmail(e);
        if (m && m.lead_id === lead.id) return { lead_id: lead.id, contact_id: m.contact_id, how: 'id' };
      }
      return { lead_id: lead.id, contact_id: null, how: 'id' };
    }
  }
  for (const e of input.emails ?? []) {
    const m = await repo.findByEmail(e);
    if (m) return { lead_id: m.lead_id, contact_id: m.contact_id, how: 'email' };
  }
  for (const p of input.phones ?? []) {
    const m = await repo.findByPhone(p);
    if (m) return { lead_id: m.lead_id, contact_id: m.contact_id, how: 'phone' };
  }
  if (input.companyName) {
    const leads = await repo.findLeadsByName(input.companyName);
    if (leads.length === 1) return { lead_id: leads[0].id, contact_id: null, how: 'name' };
  }
  return null;
}
