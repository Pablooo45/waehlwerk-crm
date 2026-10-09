// „Mehr“ am Handy: alles, was nicht in die untere Leiste passt.

import { ChevronRight, CircleUserRound, Keyboard, LogOut, Moon, Pin, Settings, Zap } from 'lucide-react';
import { useApp } from '../../app/context.tsx';
import { useNavItems } from '../../app/nav.tsx';
import { routeHref } from '../../app/router.ts';
import { pinnedViews } from '../../lib/views.ts';
import { Avatar } from '../../ui/ui.tsx';
import { useDialer } from '../dialer/DialerContext.tsx';

const IN_BOTTOM_BAR = ['Inbox', 'Leads', 'Gespräche', 'Termine'];

export default function MorePage() {
  const { me, ref, store, reloadRef, signOut } = useApp();
  const dialer = useDialer();
  const items = useNavItems(0).filter((n) => !IN_BOTTOM_BAR.includes(n.label));
  const views = pinnedViews(ref.smartViews, me.settings.pinnedViews, me.settings.hiddenViews);
  const role = ref.roles.find((r) => r.id === me.role_id)?.name ?? '';

  const toggleTheme = async () => {
    const theme = me.settings.theme ?? 'system';
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    await store.updateMyProfile({ settings: { ...me.settings, theme: dark ? 'light' : 'dark' } });
    await reloadRef();
  };

  return (
    <div className="page more-page">
      <a href="#/settings/profile" className="more-me">
        <Avatar name={me.full_name || me.email} color={me.color} large />
        <span className="grow">
          <strong>{me.full_name || me.email}</strong>
          <span className="block small muted">{role}{ref.org.name ? `, ${ref.org.name}` : ''}</span>
        </span>
        <ChevronRight />
      </a>

      <nav className="more-list" aria-label="Weitere Bereiche">
        {dialer.active ? (
          <a href="#/dialer"><Zap /> Power Dialer <ChevronRight className="more-chevron" /></a>
        ) : null}
        {items.map((n) => (
          <a key={n.label} href={routeHref(n.route)}>
            {n.icon} {n.label} <ChevronRight className="more-chevron" />
          </a>
        ))}
        <a href="#/views"><Pin /> Alle Smart Views <ChevronRight className="more-chevron" /></a>
      </nav>

      {views.length ? (
        <>
          <h2 className="more-title">Smart Views</h2>
          <nav className="more-list" aria-label="Smart Views">
            {views.map((v) => (
              <a key={v.id} href={routeHref({ name: 'leads', viewId: v.id })}>
                {v.name} <ChevronRight className="more-chevron" />
              </a>
            ))}
          </nav>
        </>
      ) : null}

      <h2 className="more-title">Konto</h2>
      <nav className="more-list" aria-label="Konto">
        <a href="#/settings/profile"><CircleUserRound /> Mein Profil <ChevronRight className="more-chevron" /></a>
        <a href="#/settings/profile"><Settings /> Einstellungen <ChevronRight className="more-chevron" /></a>
        <button type="button" onClick={toggleTheme}><Moon /> Hell / Dunkel</button>
        <button type="button" className="hide-mobile" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}>
          <Keyboard /> Tastenkürzel
        </button>
        <button type="button" onClick={() => signOut()}><LogOut /> Abmelden</button>
      </nav>
    </div>
  );
}
