// Platzhalter in E-Mail- und SMS-Vorlagen: {{ contact.first_name }} usw.
// Gemeinsam für Browser und Server (Workflows, Sammel-E-Mails). Keine Deno- oder Browser-Aufrufe.

export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (_, key: string) => vars[key] ?? '');
}

export function templateVars(
  lead: { name: string; address_city: string | null } | null,
  contact: { name: string } | null,
  user: { full_name: string; email: string },
  orgName: string,
): Record<string, string> {
  const name = contact?.name ?? '';
  const parts = name.replace(/^(Dr\.|Prof\.)\s+/g, '').split(' ').filter(Boolean);
  return {
    'lead.name': lead?.name ?? '',
    'lead.address_city': lead?.address_city ?? '',
    'contact.name': name,
    'contact.first_name': parts[0] ?? '',
    'contact.last_name': parts.slice(1).join(' '),
    'user.name': user.full_name,
    'user.first_name': user.full_name.split(' ')[0] ?? '',
    'user.email': user.email,
    'organization.name': orgName,
  };
}
