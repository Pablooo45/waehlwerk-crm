// Hauptnavigation – gemeinsam für Seitenleiste, Handy-Menü („Mehr“) und Suche.

import { BarChart3, CalendarDays, Columns3, Contact, Headphones, Inbox, MessagesSquare, Rows3, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';
import { useApp } from './context.tsx';
import type { Route } from './router.ts';

export interface NavItem {
  route: Route;
  label: string;
  icon: ReactNode;
  count?: number;
  match: Route['name'][];
}

export function useNavItems(inbox: number): NavItem[] {
  const { can } = useApp();
  const items: (NavItem | false)[] = [
    { route: { name: 'inbox', box: 'inbox', userId: null }, label: 'Inbox', icon: <Inbox />, count: inbox, match: ['inbox'] },
    { route: { name: 'leads', viewId: null }, label: 'Leads', icon: <Rows3 />, match: ['leads', 'lead', 'views'] },
    { route: { name: 'contacts' }, label: 'Kontakte', icon: <Contact />, match: ['contacts'] },
    { route: { name: 'opportunities', pipelineId: null }, label: 'Opportunities', icon: <Columns3 />, match: ['opportunities'] },
    { route: { name: 'calls' }, label: 'Gespräche', icon: <MessagesSquare />, match: ['calls', 'call'] },
    { route: { name: 'meetings' }, label: 'Termine', icon: <CalendarDays />, match: ['meetings'] },
    { route: { name: 'workflows' }, label: 'Workflows', icon: <Workflow />, match: ['workflows', 'workflow'] },
    { route: { name: 'reports', tab: null }, label: 'Berichte', icon: <BarChart3 />, match: ['reports'] },
    (can('call_coach_listen') || can('call_coach_barge')) && { route: { name: 'live' }, label: 'Live-Gespräche', icon: <Headphones />, match: ['live'] },
  ];
  return items.filter((x): x is NavItem => !!x);
}

