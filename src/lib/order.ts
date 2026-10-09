// Reihenfolgen in Einstellungen (Status, Felder, Ergebnisse …): verschieben und neue Sortierwerte vergeben.

/** Element von Position `from` nach `to` verschieben (neue Liste, Original bleibt unverändert). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}

/** Neue Sortierwerte 10, 20, 30 … – nur die Einträge zurückgeben, deren Wert sich ändert. */
export function resort<T>(next: T[], sortOf: (t: T) => number): { item: T; sort: number }[] {
  return next.map((item, i) => ({ item, sort: (i + 1) * 10 })).filter((x) => sortOf(x.item) !== x.sort);
}
