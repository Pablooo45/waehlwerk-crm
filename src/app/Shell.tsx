import {
  Bell,
  CalendarDays,
  ChevronDown,
  CircleUserRound,
  Grid3x3,
  Inbox,
  Keyboard,
  LogOut,
  Menu,
  Moon,
  PhoneCall,
  Pin,
  Plus,
  Rows3,
  Settings,
  Sun,
  Workflow,
  Zap,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { bus } from '../lib/bus.ts';
import { config } from '../lib/config.ts';
import { formatPhone, formatRelative, normalizePhone } from '../lib/format.ts';
import type { DemoPhone } from '../lib/phone/demoPhone.ts';
import type { DemoStore } from '../lib/store/demoStore.ts';
import { pinnedViews } from '../lib/views.ts';
import { Avatar, cx, errMsg, Loading, MenuItem, Modal, Popover, useHotkeys, useMenu, useUi } from '../ui/ui.tsx';
import { CallBar, Keypad } from '../features/calling/CallBar.tsx';
import { IncomingCall } from '../features/calling/IncomingCall.tsx';
import { WrapUp } from '../features/calling/WrapUp.tsx';
import { LeadFormModal, TaskFormModal } from '../features/common/forms.tsx';
import { DialerProvider, useDialer } from '../features/dialer/DialerContext.tsx';
import { useApp, usePhone } from './context.tsx';
import { useAsync } from './hooks.ts';
import { navigate, type Route, routeHref, useRoute } from './router.ts';
import { type NavItem, useNavItems } from './nav.tsx';
import { Search } from './Search.tsx';
import { NotificationsBell } from './Notifications.tsx';
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
  const { me, ref, signOut, demo, store, phone, can, reloadRef } = useApp();
  const { toast } = useUi();
  const inbox = useInboxCount();
  const [newLead, setNewLead] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [dialpad, setDialpad] = useState(false);
  const [help, setHelp] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const newMenu = useMenu();
  const userMenu = useMenu();
  const gPressed = useRef(0);

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
  useHotkeys({
    '?': () => setHelp(true),
    g: () => (gPressed.current = Date.now()),
    i: () => Date.now() - gPressed.current < 900 && go({ name: 'inbox', box: 'inbox', userId: null }),
    l: () => Date.now() - gPressed.current < 900 && go({ name: 'leads', viewId: null }),
    k: () => Date.now() - gPressed.current < 900 && go({ name: 'contacts' }),
    o: () => Date.now() - gPressed.current < 900 && go({ name: 'opportunities', pipelineId: null }),
    a: () => Date.now() - gPressed.current < 900 && go({ name: 'calls' }),
    t: () => Date.now() - gPressed.current < 900 && go({ name: 'meetings' }),
    w: () => Date.now() - gPressed.current < 900 && go({ name: 'workflows' }),
    r: () => Date.now() - gPressed.current < 900 && go({ name: 'reports', tab: null }),
    s: () => Date.now() - gPressed.current < 900 && go({ name: 'settings', section: 'profile' }),
    n: () => setNewLead(true),
    c: () => Date.now() - gPressed.current >= 900 && setDialpad(true),
  });

  const nav = useNavItems(inbox);
  const lineClass = snap.call ? (snap.call.state === 'open' ? 'live' : 'busy') : snap.status === 'ready' ? (me.available ? 'ready' : 'dnd') : snap.status === 'error' ? 'error' : '';
  const showGlobalWrapUp = !!snap.ended && !(dialer.active && route.name === 'dialer');
  const isActive = (n: NavItem) => n.match.includes(route.name);
  const phoneText = snap.call
    ? snap.call.state === 'open' ? 'Im Gespräch' : 'Wählt…'
    : snap.status === 'ready' ? (me.available ? 'Erreichbar' : 'Nicht stören') : snap.status === 'starting' ? 'Verbinde…' : snap.status === 'unconfigured' ? 'Telefonie nicht eingerichtet' : snap.status === 'offline' ? 'Getrennt' : snap.status === 'error' ? 'Telefon-Fehler' : 'Telefon aus';
  const views = pinnedViews(ref.smartViews, me.settings.pinnedViews, me.settings.hiddenViews);

  const toggleAvailable = async () => {
    try {
      await store.updateMyProfile({ available: !me.available });
      await reloadRef();
      toast(me.available ? 'Nicht stören: Anrufe gehen an Kollegen, Weiterleitung oder Mailbox.' : 'Du bist wieder erreichbar.');
    } catch (e) {
      toast(String(e), { kind: 'error' });
    }
  };

  const theme = me.settings.theme ?? 'system';
  const toggleTheme = async () => {
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    await store.updateMyProfile({ settings: { ...me.settings, theme: dark ? 'light' : 'dark' } });
    await reloadRef();
  };

  return (
    <div className={cx('app', navOpen && 'nav-open')}>
      <aside className="sidebar" aria-label="Hauptnavigation">
        <div className="brand">
          <span className={cx('line-dot', lineClass)} title={phoneText} />
          <span className="brand-name">{config.appName}</span>
          <span className="brand-org ellipsis" title={ref.org.name}>{ref.org.name}</span>
        </div>
        <nav className="nav">
          {nav.map((n) => (
            <a key={n.label} href={routeHref(n.route)} className={cx(isActive(n) && 'active')}>
              {n.icon}
              {n.label}
              {n.count ? <span className="count">{n.count > 99 ? '99+' : n.count}</span> : null}
            </a>
          ))}
          {dialer.active ? (
            <a href="#/dialer" className={cx(route.name === 'dialer' && 'active')}>
              <Zap />
              Power Dialer
            </a>
          ) : null}
        </nav>
        <div className="views" aria-label="Smart Views">
          <div className="views-head">
            <span className="grow">Smart Views</span>
            <a href="#/views" className="icon-btn small" title="Alle Smart Views" aria-label="Alle Smart Views">
              <Pin />
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
          <button type="button" className="phone-chip" onClick={toggleAvailable} title="Erreichbarkeit umschalten">
            <span className={cx('line-dot', lineClass)} />
            <span className="grow">
              {phoneText}
              <br />
              <span className="muted xs">{demo ? 'Demo – keine echten Anrufe' : snap.message ?? (me.available ? 'Klicken für „Nicht stören“' : 'Klicken, um erreichbar zu sein')}</span>
            </span>
          </button>
          <div className="me">
            <button type="button" className="me-btn" onClick={userMenu.open} aria-haspopup="menu">
              <Avatar name={me.full_name || me.email} color={me.color} />
              <span className="grow ellipsis">
                {me.full_name || me.email}
                <span className="block xs muted ellipsis">{ref.roles.find((r) => r.id === me.role_id)?.name ?? ''}</span>
              </span>
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </aside>
      {navOpen ? <div className="nav-scrim" onClick={() => setNavOpen(false)} /> : null}

      <div className="main">
        {demo ? <DemoBanner onIncoming={() => (phone as unknown as DemoPhone).simulateIncoming?.()} onReset={() => { (store as unknown as DemoStore).reset(); location.reload(); }} /> : <JobsBanner />}
        <header className="topbar">
          <button type="button" className="icon-btn show-mobile" onClick={() => setNavOpen(true)} aria-label="Menü öffnen">
            <Menu />
          </button>
          <Search onNewLead={() => setNewLead(true)} onDial={() => setDialpad(true)} />
          <NotificationsBell />
          <button type="button" className="icon-btn hide-mobile" onClick={() => setHelp(true)} title="Tastenkürzel (?)" aria-label="Tastenkürzel">
            <Keyboard />
          </button>
          <button type="button" className="btn hide-mobile" onClick={() => setDialpad(true)} title="Nummer wählen (C)" disabled={!can('calling')}>
            <Grid3x3 /> Wählen
          </button>
          <button type="button" className="btn primary" onClick={newMenu.open} aria-haspopup="menu">
            <Plus /> <span className="hide-mobile">Neu</span>
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
        <a href={dialer.active ? '#/dialer' : '#/meetings'} className={cx((route.name === 'meetings' || route.name === 'dialer') && 'active')}>
          {dialer.active ? <Zap /> : <CalendarDays />} {dialer.active ? 'Dialer' : 'Termine'}
        </a>
        <a href="#/calls" className={cx((route.name === 'calls' || route.name === 'call') && 'active')}>
          <PhoneCall /> Gespräche
        </a>
        <a href="#/more" className={cx(!['inbox', 'leads', 'lead', 'views', 'meetings', 'dialer', 'calls', 'call'].includes(route.name) && 'active')}>
          <Menu /> Mehr
        </a>
      </nav>

      {newMenu.isOpen ? (
        <Popover anchor={newMenu.anchor} onClose={newMenu.close} align="end">
          <MenuItem icon={<Rows3 />} onClick={() => { newMenu.close(); setNewLead(true); }}>Lead (N)</MenuItem>
          <MenuItem icon={<Bell />} onClick={() => { newMenu.close(); setNewTask(true); }}>Aufgabe</MenuItem>
          {can('calling') ? <MenuItem icon={<PhoneCall />} onClick={() => { newMenu.close(); setDialpad(true); }}>Anruf (C)</MenuItem> : null}
          {can('manage_workflows') ? <MenuItem icon={<Workflow />} onClick={() => { newMenu.close(); navigate('#/workflows/new'); }}>Workflow</MenuItem> : null}
        </Popover>
      ) : null}
      {userMenu.isOpen ? (
        <Popover anchor={userMenu.anchor} onClose={userMenu.close}>
          <MenuItem icon={<CircleUserRound />} onClick={() => { userMenu.close(); navigate('#/settings/profile'); }}>Mein Profil</MenuItem>
          <MenuItem icon={<Settings />} onClick={() => { userMenu.close(); navigate('#/settings/profile'); }}>Einstellungen</MenuItem>
          <MenuItem icon={theme === 'dark' ? <Sun /> : <Moon />} onClick={() => { userMenu.close(); toggleTheme(); }}>Hell / Dunkel</MenuItem>
          <MenuItem icon={<Keyboard />} onClick={() => { userMenu.close(); setHelp(true); }}>Tastenkürzel</MenuItem>
          <MenuItem icon={<LogOut />} onClick={() => { userMenu.close(); signOut(); }}>Abmelden</MenuItem>
        </Popover>
      ) : null}

      <IncomingCall />
      {newLead ? <LeadFormModal onClose={() => setNewLead(false)} /> : null}
      {newTask ? <TaskFormModal onClose={() => setNewTask(false)} /> : null}
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

function DialpadModal({ onClose }: { onClose: () => void }) {
  const { dial, store } = useApp();
  const [number, setNumber] = useState('');
  const valid = !!normalizePhone(number);
  const go = async () => {
    if (!valid) return;
    const match = await store.findLeadByPhone(number).catch(() => null);
    const ok = await dial({
      number,
      leadId: match?.lead.id ?? null,
      contactId: match?.contact?.id ?? null,
      leadName: match?.lead.name ?? null,
      contactName: match?.contact?.name ?? null,
    });
    if (ok) onClose();
  };
  return (
    <Modal title="Nummer wählen" onClose={onClose}>
      <div className="col gap-12">
        <input
          className="input"
          style={{ fontSize: 22, textAlign: 'center', fontWeight: 700 }}
          type="tel"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder="069 123456"
          autoFocus
        />
        <Keypad onDigit={(d) => setNumber((n) => n + d)} />
        <button type="button" className="btn call large block" onClick={go} disabled={!valid}>
          <PhoneCall /> {valid ? `${formatPhone(number)} anrufen` : 'Anrufen'}
        </button>
      </div>
    </Modal>
  );
}
