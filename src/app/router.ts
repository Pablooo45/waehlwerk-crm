// Einfache Navigation über die Adresse (#/leads/…), funktioniert auch auf GitHub Pages.

import { useEffect, useState } from 'react';

export type InboxBox = 'inbox' | 'later' | 'done';

export type Route =
  | { name: 'inbox'; box: InboxBox; userId: string | null }
  | { name: 'leads'; viewId: string | null }
  | { name: 'lead'; id: string }
  | { name: 'views' }
  | { name: 'contacts' }
  | { name: 'opportunities'; pipelineId: string | null }
  | { name: 'calls' }
  | { name: 'call'; id: string }
  | { name: 'dialer' }
  | { name: 'meetings' }
  | { name: 'workflows' }
  | { name: 'workflow'; id: string }
  | { name: 'reports'; tab: string | null }
  | { name: 'live' }
  | { name: 'more' }
  | { name: 'settings'; section: string };

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#/, '');
  if (!clean.startsWith('/')) return { name: 'inbox', box: 'inbox', userId: null };
  const [path, query = ''] = clean.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  const id = parts[1] ? decodeURIComponent(parts[1]) : null;
  switch (parts[0]) {
    case 'inbox': {
      const box = params.get('box');
      return { name: 'inbox', box: box === 'later' || box === 'done' ? box : 'inbox', userId: params.get('user') };
    }
    case 'leads':
      if (id) return { name: 'lead', id };
      return { name: 'leads', viewId: params.get('view') };
    case 'views':
      return { name: 'views' };
    case 'contacts':
      return { name: 'contacts' };
    case 'pipeline':
    case 'opportunities':
      return { name: 'opportunities', pipelineId: params.get('pipeline') };
    case 'calls':
      if (id) return { name: 'call', id };
      return { name: 'calls' };
    case 'dialer':
      return { name: 'dialer' };
    case 'meetings':
      return { name: 'meetings' };
    case 'workflows':
      if (id) return { name: 'workflow', id };
      return { name: 'workflows' };
    case 'reports':
      return { name: 'reports', tab: params.get('tab') };
    case 'live':
      return { name: 'live' };
    case 'more':
      return { name: 'more' };
    case 'settings':
      return { name: 'settings', section: parts[1] ?? 'profile' };
    default:
      return { name: 'inbox', box: 'inbox', userId: null };
  }
}

export function routeHref(r: Route): string {
  switch (r.name) {
    case 'inbox': {
      const q = new URLSearchParams();
      if (r.box !== 'inbox') q.set('box', r.box);
      if (r.userId) q.set('user', r.userId);
      const s = q.toString();
      return `#/inbox${s ? `?${s}` : ''}`;
    }
    case 'leads':
      return r.viewId ? `#/leads?view=${encodeURIComponent(r.viewId)}` : '#/leads';
    case 'lead':
      return `#/leads/${encodeURIComponent(r.id)}`;
    case 'opportunities':
      return r.pipelineId ? `#/opportunities?pipeline=${encodeURIComponent(r.pipelineId)}` : '#/opportunities';
    case 'call':
      return `#/calls/${encodeURIComponent(r.id)}`;
    case 'workflow':
      return `#/workflows/${encodeURIComponent(r.id)}`;
    case 'reports':
      return r.tab ? `#/reports?tab=${encodeURIComponent(r.tab)}` : '#/reports';
    case 'settings':
      return `#/settings/${r.section}`;
    default:
      return `#/${r.name}`;
  }
}

export function navigate(to: string | Route) {
  const href = typeof to === 'string' ? to : routeHref(to);
  if (location.hash !== href) location.hash = href;
}

export function leadHref(id: string) {
  return routeHref({ name: 'lead', id });
}

export function callHref(id: string) {
  return routeHref({ name: 'call', id });
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(location.hash));
      document.querySelector('.content')?.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
