import { Modal } from '../ui/ui.tsx';

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Überall',
    keys: [
      ['Strg + K  oder  /', 'Suchen und springen'],
      ['N', 'Neuer Lead'],
      ['C', 'Nummer wählen'],
      ['?', 'Diese Übersicht'],
    ],
  },
  {
    title: 'Springen (erst G, dann …)',
    keys: [
      ['G  I', 'Inbox'],
      ['G  L', 'Leads'],
      ['G  K', 'Kontakte'],
      ['G  O', 'Opportunities'],
      ['G  A', 'Gespräche (Anrufe)'],
      ['G  T', 'Termine'],
      ['G  W', 'Workflows'],
      ['G  R', 'Berichte'],
      ['G  S', 'Einstellungen'],
    ],
  },
  {
    title: 'Auf einer Lead-Seite',
    keys: [
      ['C', 'Anrufen'],
      ['N', 'Notiz schreiben'],
      ['E', 'E-Mail schreiben'],
      ['T', 'Aufgabe anlegen'],
    ],
  },
  {
    title: 'Nach dem Anruf',
    keys: [
      ['1 … 9', 'Ergebnis wählen'],
      ['Strg + Enter', 'Speichern und weiter'],
    ],
  },
  {
    title: 'Aufnahme abspielen',
    keys: [
      ['Leertaste', 'Abspielen / Pause'],
      ['← / →', '10 Sekunden zurück / vor'],
      ['M', 'Markierung mit Kommentar setzen'],
    ],
  },
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Tastenkürzel" onClose={onClose} wide>
      <div className="shortcuts">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.keys.map(([k, v]) => (
                <div key={k} className="row">
                  <dt>
                    {k.split('  ').map((part) => (
                      <kbd key={part}>{part}</kbd>
                    ))}
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
