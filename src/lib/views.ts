// Welche Smart Views stehen in der Seitenleiste?
// Team-Ansichten mit „angeheftet“ (außer ich habe sie ausgeblendet) plus meine eigenen Stecknadeln.

import type { ID, SmartView } from './types.ts';

export function pinnedViews(views: SmartView[], pins: ID[] = [], hidden: ID[] = []): SmartView[] {
  const out = views.filter((v) => (v.pinned && !hidden.includes(v.id)) || pins.includes(v.id));
  return out.sort((a, b) => a.position - b.position);
}
