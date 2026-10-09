import { lazy, Suspense, useEffect, useRef } from 'react';
import { useApp } from '../../app/context.tsx';
import { cx, Empty, Loading } from '../../ui/ui.tsx';
import { SETTINGS_ALIASES, SETTINGS_ITEMS } from './items.ts';

const Profile = lazy(() => import('./Profile.tsx'));
const Voicemail = lazy(() => import('./Voicemail.tsx'));
const Mailbox = lazy(() => import('./Mailbox.tsx'));
const Templates = lazy(() => import('./Templates.tsx'));
const Team = lazy(() => import('./Team.tsx'));
const Roles = lazy(() => import('./Roles.tsx'));
const Groups = lazy(() => import('./Groups.tsx'));
const Numbers = lazy(() => import('./Numbers.tsx'));
const Telephony = lazy(() => import('./Telephony.tsx'));
const Recordings = lazy(() => import('./Recordings.tsx'));
const Customize = lazy(() => import('./Customize.tsx'));
const Forms = lazy(() => import('./Forms.tsx'));
const Calendar = lazy(() => import('./Calendar.tsx'));
const Ai = lazy(() => import('./Ai.tsx'));
const CloseImport = lazy(() => import('./CloseImport.tsx'));
const ImportExport = lazy(() => import('./ImportExport.tsx'));
const Duplicates = lazy(() => import('./Duplicates.tsx'));
const Diagnose = lazy(() => import('./Diagnose.tsx'));

export default function SettingsPage({ section }: { section: string }) {
  const { can, isAdmin } = useApp();
  const navRef = useRef<HTMLElement>(null);
  const items = SETTINGS_ITEMS.filter((i) => i.visible({ can, isAdmin }));

  // Auf dem Handy ist das Menü eine waagerechte Leiste: aktiven Punkt sichtbar machen.
  useEffect(() => {
    const nav = navRef.current;
    const a = nav?.querySelector<HTMLElement>('a.active');
    if (!nav || !a || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft += a.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - a.offsetWidth) / 2;
  }, [section]);

  const current = items.find((i) => i.id === (SETTINGS_ALIASES[section] ?? section));
  let group = '';
  return (
    <div className="page">
      <div className="page-head">
        <h1>Einstellungen</h1>
      </div>
      <div className="settings">
        <nav className="settings-nav" aria-label="Einstellungen" ref={navRef}>
          {items.map((i) => {
            const head = i.group !== group ? (group = i.group) : null;
            return (
              <span key={i.id} style={{ display: 'contents' }}>
                {head ? <span className="group">{head}</span> : null}
                <a href={`#/settings/${i.id}`} className={cx(current?.id === i.id && 'active')}>
                  {i.label}
                </a>
              </span>
            );
          })}
        </nav>
        <div style={{ minWidth: 0 }}>
          <Suspense fallback={<Loading />}>
            {!current ? (
              <Empty title="Dieser Bereich ist für deine Rolle nicht freigegeben">
                Frag einen Admin, wenn du hier etwas ändern musst.
              </Empty>
            ) : null}
            {current?.id === 'profile' ? <Profile /> : null}
            {current?.id === 'voicemail' ? <Voicemail /> : null}
            {current?.id === 'mailbox' ? <Mailbox /> : null}
            {current?.id === 'templates' ? <Templates /> : null}
            {current?.id === 'team' ? <Team /> : null}
            {current?.id === 'roles' ? <Roles /> : null}
            {current?.id === 'groups' ? <Groups /> : null}
            {current?.id === 'numbers' ? <Numbers /> : null}
            {current?.id === 'telephony' ? <Telephony /> : null}
            {current?.id === 'recordings' ? <Recordings /> : null}
            {current && ['statuses', 'outcomes', 'fields', 'script', 'links'].includes(current.id) ? <Customize section={section} /> : null}
            {current?.id === 'forms' ? <Forms /> : null}
            {current?.id === 'calendar' ? <Calendar /> : null}
            {current?.id === 'ai' ? <Ai /> : null}
            {current?.id === 'close' ? <CloseImport /> : null}
            {current?.id === 'import' ? <ImportExport /> : null}
            {current?.id === 'duplicates' ? <Duplicates /> : null}
            {current?.id === 'diagnose' ? <Diagnose /> : null}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
