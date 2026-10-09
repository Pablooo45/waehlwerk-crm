import {
  CalendarDays,
  ChevronDown,
  CircleUserRound,
  Columns3,
  Inbox,
  Keyboard,
  LogOut,
  Menu,
  Moon,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  Rows3,
  Search as SearchIcon,
  Settings,
  Sun,
  Zap,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { bus } from '../lib/bus.ts';
import { config } from '../lib/config.ts';
import { formatRelative } from '../lib/format.ts';
import type { DemoPhone } from '../lib/phone/demoPhone.ts';
import type { DemoStore } from '../lib/store/demoStore.ts';
import { pinnedViews } from '../lib/views.ts';
import { Avatar, cx, errMsg, Loading, MenuItem, Popover, useHotkeys, useMenu, useUi } from '../ui/ui.tsx';
import { CallBar } from '../features/calling/CallBar.tsx';
import { IncomingCall } from '../features/calling/IncomingCall.tsx';
import { WrapUp } from '../features/calling/WrapUp.tsx';
import { LeadFormModal } from '../features/common/forms.tsx';
import { DialerProvider, useDialer } from '../features/dialer/DialerContext.tsx';
import { useApp, usePhone } from './context.tsx';
import { useAsync } from './hooks.ts';
import { navigate, type Route, routeHref, useRoute } from './router.ts';
import { type NavItem, useNavItems } from './nav.tsx';
import { SearchPalette } from './Search.tsx';
import { DialpadModal, PhonePanel, usePhoneLine } from './PhonePanel.tsx';
import { ShortcutsHelp } from './ShortcutsHelp.tsx';

const InboxPage = lazy(() => import('../features/inbox/InboxPage.tsx'));
const LeadsPage = lazy(() => import('../features/leads/LeadsPage.tsx'));
const LeadPage = lazy(() => import('../features/leads/LeadPage.tsx'));
const ViewsPage = lazy(() => import('../features/leads/ViewsPage.tsx'));
const ContactsPage = lazy(() => import('../features/contacts/ContactsPage.tsx'));
const DialerPage = lazy(() => import('../features/dialer/DialerPage.tsx'));
const MeetingsPage = lazy(() => import('../features/meetings/MeetingsPage.tsx'));
const OpportunitiesPage = lazy(() => import('../features/pipeline/PipelinePage.tsx'));
const CallsPage = lazy(() => import('../features/calls/CallsPage.tsx'));
const CallPage = lazy(() => import('../features/calls/CallPage.tsx'));
const LivePage = lazy(() => import('../features/calls/LivePage.tsx'));
const WorkflowsPage = lazy(() => import('../features/workflows/WorkflowsPage.tsx'));
const WorkflowPage = lazy(() => import('../features/workflows/WorkflowPage.tsx'));
const ReportsPage = lazy(() => import('../features/reports/ReportsPage.tsx'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage.tsx'));
const MorePage = lazy(() => import('../features/more/MorePage.tsx'));

export function Shell() {
  return (
    <DialerProvider>
      <ShellInner />
    </DialerProvider>
  );
}

function useInboxCount() {
  const { store, me } = useApp();
  const q = useAsync(async () => {
    const c = await store.inboxCounts();
    return c.tasks_due + c.notifications_new;
  }, [store, me.id], ['tasks', 'notifications']);
  useEffect(() => {
    const offs = [
      store.subscribe('tasks', () => bus.emit('tasks')),
      store.subscribe('notifications', () => bus.emit('notifications')),
    ];
    return () => offs.forEach((off) => off());
  }, [store]);
  return q.data ?? 0;
}


function ShellInner() {
  const route = useRoute();
  const snap = usePhone();
  const dialer = useDialer();
  const { me, ref, signOut, demo, store, phone, reloadRef } = useApp();
  const inbox = useInboxCount();
  const [newLead, setNewLead] = useState(false);
  const [dialpad, setDialpad] = useState(false);
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const userMenu = useMenu();
  const phoneMenu = useMenu();
  const gPressed = useRef(0);
  const { lineClass, phoneText } = usePhoneLine();

  // Live-Updates aus der Datenbank an die Seiten weitergeben
  useEffect(() => {
    const offs = [
      store.subscribe('calls', (row) => {
        bus.emit('calls', row);
        if (row.lead_id) bus.emit('timeline', row.lead_id);
      }),
      store.subscribe('meetings', () => bus.emit('meetings')),
      store.subscribe('sms_messages', (row) => {
        bus.emit('messages', row);
        if (row.lead_id) bus.emit('timeline', row.lead_id);
      }),
      store.subscribe('emails', (row) => {
        bus.emit('messages', row);
        if (row.lead_id) bus.emit('timeline', row.lead_id);
      }),
      store.subscribe('call_insights', (row) => bus.emit('insights', row)),
    ];
    return () => offs.forEach((off) => off());
  }, [store]);

  useEffect(() => setNavOpen(false), [route]);

  // Lebenszeichen: „zuletzt online“ in der Team-Übersicht und für eingehende Anrufe
  // (wer das CRM offen hat – auch im Hintergrund-Tab –, klingelt bevorzugt)
  useEffect(() => {
    const beat = () => {
      store.heartbeat().catch(() => undefined);
    };
    beat();
    const id = setInterval(beat, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store]);

  const go = (r: Route) => navigate(r);
  const g = () => Date.now() - gPressed.current < 900;
  useHotkeys({
    '?': () => setHelp(true),
    'mod+k': (e) => {
      e.preventDefault();
      setSearch(true);
    },
    '/': (e) => {
      e.preventDefault();
      setSearch(true);
    },
    'mod+shift+l': (e) => {
      e.preventDefault();
      setNewLead(true);
    },
    g: () => (gPressed.current = Date.now()),
    i: () => g() && go({ name: 'inbox', box: 'inbox', userId: null }),
    l: () => g() && go({ name: 'leads', viewId: null }),
    k: () => g() && go({ name: 'contacts' }),
    o: () => g() && go({ name: 'opportunities', pipelineId: null }),
    a: () => g() && go({ name: 'calls' }),
    t: () => g() && go({ name: 'meetings' }),
    w: () => g() && go({ name: 'workflows' }),
    r: () => g() && go({ name: 'reports', tab: null }),
    s: () => g() && go({ name: 'settings', section: 'profile' }),
    // „N“ = neuer Lead – auf einer Lead-Seite heißt N „Notiz“
    n: () => !g() && route.name !== 'lead' && setNewLead(true),
  });

  const nav = useNavItems(inbox);
  const showGlobalWrapUp = !!snap.ended && !(dialer.active && route.name === 'dialer');
  const isActive = (n: NavItem) => n.match.includes(route.name);
  const views = pinnedViews(ref.smartViews, me.settings.pinnedViews, me.settings.hiddenViews);

  const theme = me.settings.theme ?? 'system';
  const toggleTheme = async () => {
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    await store.updateMyProfile({ settings: { ...me.settings, theme: dark ? 'light' : 'dark' } });
    await reloadRef();
  };

  return (
    <div className={cx('app', navOpen && 'nav-open')}>
      <aside className="sidebar" aria-label="Hauptnavigation">
        <div className="side-top">
          <button type="button" className="account-btn" onClick={userMenu.open} aria-haspopup="menu" title="Konto und Einstellungen">
            <Avatar name={me.full_name || me.email} color={me.color} />
            <span className="grow account-text">
              <span className="account-org ellipsis">{ref.org.name || config.appName}</span>
              <span className="account-user ellipsis">{me.full_name || me.email}</span>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <button type="button" className="phone-btn" onClick={phoneMenu.open} aria-haspopup="dialog" aria-label={`Telefon: ${phoneText}`} title={`Telefon: ${phoneText}`}>
            <Phone />
            <span className={cx('line-dot', lineClass)} aria-hidden="true" />
          </button>
        </div>
        <button type="button" className="side-search" onClick={() => setSearch(true)}>
          <SearchIcon aria-hidden="true" />
          <span className="grow">Suchen</span>
          <kbd className="hide-touch">Strg K</kbd>
        </button>
        <nav className="nav">
          {nav.map((n) => (
            <div key={n.label} className="nav-row">
              <a href={routeHref(n.route)} className={cx(isActive(n) && 'active')} aria-current={isActive(n) ? 'page' : undefined}>
                {n.icon}
                <span className="grow">{n.label}</span>
                {n.count ? <span className="count">{n.count > 99 ? '99+' : n.count}</span> : null}
              </a>
              {n.label === 'Leads' ? (
                <button type="button" className="nav-add" onClick={() => setNewLead(true)} aria-label="Neuen Lead anlegen" title="Neuer Lead (Strg + Umschalt + L)">
                  <Plus />
                </button>
              ) : null}
            </div>
          ))}
          {dialer.active ? (
            <a href="#/dialer" className={cx('nav-dialer', route.name === 'dialer' && 'active')}>
              <Zap />
              <span className="grow">Power Dialer</span>
            </a>
          ) : null}
        </nav>
        <div className="views" aria-label="Smart Views">
          <div className="views-head">
            <span className="grow">Smart Views</span>
            <a href="#/views" className="icon-btn small" title="Smart Views verwalten" aria-label="Smart Views verwalten">
              <Pencil />
            </a>
          </div>
          {views.map((v) => (
            <a
              key={v.id}
              href={routeHref({ name: 'leads', viewId: v.id })}
              className={cx(route.name === 'leads' && route.viewId === v.id && 'active')}
              title={v.name}
            >
              {v.name}
            </a>
          ))}
          <a href="#/views" className={cx('views-all', route.name === 'views' && 'active')}>
            Alle Smart Views ({ref.smartViews.length})
          </a>
        </div>
        <div className="sidebar-foot">
          <a href="#/settings/profile" className={cx('foot-link', route.name === 'settings' && 'active')}>
            <Settings /> Einstellungen
          </a>
          <button type="button" className="icon-btn small hide-touch" onClick={() => setHelp(true)} title="Tastenkürzel (?)" aria-label="Tastenkürzel">
            <Keyboard />
          </button>
        </div>
      </aside>
      {navOpen ? <div className="nav-scrim" onClick={() => setNavOpen(false)} /> : null}

      <div className="main">
        {demo ? <DemoBanner onIncoming={() => (phone as unknown as DemoPhone).simulateIncoming?.()} onReset={() => { (store as unknown as DemoStore).reset(); location.reload(); }} /> : <JobsBanner />}
        <header className="topbar show-mobile-flex">
          <button type="button" className="icon-btn" onClick={() => setNavOpen(true)} aria-label="Menü öffnen">
            <Menu />
          </button>
          <button type="button" className="topbar-search" onClick={() => setSearch(true)}>
            <SearchIcon aria-hidden="true" /> Suchen
          </button>
          <button type="button" className="icon-btn phone-btn-m" onClick={phoneMenu.open} aria-label={`Telefon: ${phoneText}`}>
            <Phone />
            <span className={cx('line-dot', lineClass)} aria-hidden="true" />
          </button>
          <button type="button" className="btn primary icon-only" onClick={() => setNewLead(true)} aria-label="Neuen Lead anlegen">
            <Plus />
          </button>
        </header>
        <CallBar />
        {showGlobalWrapUp && snap.ended ? (
          <WrapUp
            key={snap.ended.id}
            ended={snap.ended}
            onDone={(o) => {
              if (dialer.active && snap.ended?.dialerSession === dialer.sessionId) dialer.afterWrapup(o);
            }}
          />
        ) : null}
        <main className="content" id="main">
          <Suspense fallback={<Loading />}>
            <Page route={route} />
          </Suspense>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Navigation">
        <a href="#/inbox" className={cx(route.name === 'inbox' && 'active')}>
          <Inbox /> Inbox
          {inbox ? <span className="count">{inbox > 99 ? '99+' : inbox}</span> : null}
        </a>
        <a href="#/leads" className={cx((route.name === 'leads' || route.name === 'lead' || route.name === 'views') && 'active')}>
          <Rows3 /> Leads
        </a>
        <a href={dialer.active ? '#/dialer' : '#/opportunities'} className={cx((route.name === 'opportunities' || route.name === 'dialer') && 'active')}>
          {dialer.active ? <Zap /> : <Columns3 />} {dialer.active ? 'Dialer' : 'Pipeline'}
        </a>
        <a href="#/calls" className={cx((route.name === 'calls' || route.name === 'call' || route.name === 'live') && 'active')}>
          <PhoneCall /> Gespräche
        </a>
        <a href="#/more" className={cx(!['inbox', 'leads', 'lead', 'views', 'opportunities', 'dialer', 'calls', 'call', 'live'].includes(route.name) && 'active')}>
          <Menu /> Mehr
        </a>
      </nav>

      {userMenu.isOpen ? (
        <Popover anchor={userMenu.anchor} onClose={userMenu.close}>
          <div className="menu-label">{me.email}</div>
          <MenuItem icon={<CircleUserRound />} onClick={() => { userMenu.close(); navigate('#/settings/profile'); }}>Mein Profil</MenuItem>
          <MenuItem icon={<Settings />} onClick={() => { userMenu.close(); navigate('#/settings/profile'); }}>Einstellungen</MenuItem>
          <MenuItem icon={<CalendarDays />} onClick={() => { userMenu.close(); navigate('#/meetings'); }}>Alle Termine</MenuItem>
          <MenuItem icon={theme === 'dark' ? <Sun /> : <Moon />} onClick={() => { userMenu.close(); toggleTheme(); }}>Hell / Dunkel</MenuItem>
          <MenuItem icon={<Keyboard />} onClick={() => { userMenu.close(); setHelp(true); }}>Tastenkürzel</MenuItem>
          <div className="menu-sep" />
          <MenuItem icon={<LogOut />} onClick={() => { userMenu.close(); signOut(); }}>Abmelden</MenuItem>
        </Popover>
      ) : null}
      {phoneMenu.isOpen ? (
        <Popover anchor={phoneMenu.anchor} onClose={phoneMenu.close}>
          <PhonePanel onClose={phoneMenu.close} />
        </Popover>
      ) : null}

      <IncomingCall />
      {search ? <SearchPalette onClose={() => setSearch(false)} onNewLead={() => setNewLead(true)} onDial={() => setDialpad(true)} /> : null}
      {newLead ? <LeadFormModal onClose={() => setNewLead(false)} /> : null}
      {dialpad ? <DialpadModal onClose={() => setDialpad(false)} /> : null}
      {help ? <ShortcutsHelp onClose={() => setHelp(false)} /> : null}
    </div>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'inbox':
      return <InboxPage box={route.box} userId={route.userId} />;
    case 'leads':
      return <LeadsPage viewId={route.viewId} />;
    case 'lead':
      return <LeadPage id={route.id} key={route.id} />;
    case 'views':
      return <ViewsPage />;
    case 'contacts':
      return <ContactsPage />;
    case 'opportunities':
      return <OpportunitiesPage pipelineId={route.pipelineId} />;
    case 'calls':
      return <CallsPage />;
    case 'call':
      return <CallPage id={route.id} key={route.id} />;
    case 'live':
      return <LivePage />;
    case 'dialer':
      return <DialerPage />;
    case 'meetings':
      return <MeetingsPage />;
    case 'workflows':
      return <WorkflowsPage />;
    case 'workflow':
      return <WorkflowPage id={route.id} key={route.id} />;
    case 'reports':
      return <ReportsPage tab={route.tab} />;
    case 'more':
      return <MorePage />;
    case 'settings':
      return <SettingsPage section={route.section} />;
  }
}

function DemoBanner({ onIncoming, onReset }: { onIncoming: () => void; onReset: () => void }) {
  return (
    <div className="demo-banner" role="note">
      <span>Demo-Modus: Beispieldaten, Anrufe werden nur simuliert.</span>
      <span className="spacer" />
      <button type="button" className="btn small" onClick={onIncoming}>
        Eingehenden Anruf simulieren
      </button>
      <button type="button" className="btn small ghost" onClick={onReset}>
        Demo zurücksetzen
      </button>
    </div>
  );
}

// Für Admins: Hinweis, solange die Hintergrundaufgaben aus sind oder nicht mehr laufen.
// Ohne sie laufen keine Workflows, geplanten E-Mails, kein Postfach-Abruf und kein Nachholen von Aufnahmen.
function JobsBanner() {
  const { store, isAdmin } = useApp();
  const { toast } = useUi();
  const state = useAsync(() => (isAdmin ? store.jobsState() : Promise.resolve(null)), [store, isAdmin]);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const s = state.data;
  if (!s || hidden) return null;
  const lastRun = s.lastRun ? Date.parse(s.lastRun) : 0;
  const stopped = s.scheduled && lastRun > 0 && Date.now() - lastRun > 15 * 60_000;
  if (s.scheduled && !stopped) return null;

  const enable = async () => {
    setBusy(true);
    try {
      await store.scheduleJobs();
      toast('Hintergrundaufgaben sind eingeschaltet – sie laufen ab jetzt jede Minute.');
      state.reload();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="demo-banner" role="status">
      <span className="grow">
        {stopped
          ? `Die Hintergrundaufgaben sind zuletzt ${formatRelative(s.lastRun!)} gelaufen – Workflows, geplante E-Mails und das Nachholen von Aufnahmen stehen gerade.`
          : 'Die Hintergrundaufgaben sind noch aus – Workflows, geplante E-Mails, Postfach-Abruf und das Nachholen von Aufnahmen laufen erst danach.'}
      </span>
      {stopped ? (
        <a className="btn small" href="#/settings/diagnose">Diagnose öffnen</a>
      ) : (
        <button type="button" className="btn small primary" onClick={enable} disabled={busy}>
          Einschalten
        </button>
      )}
      <button type="button" className="btn small ghost" onClick={() => setHidden(true)}>
        Später
      </button>
    </div>
  );
}
