// Reiter über den Gesprächen wie in Closes „Conversations“: Verlauf (abgeschlossene Anrufe) und Live (laufende).

import { useApp } from '../../app/context.tsx';
import { navigate } from '../../app/router.ts';
import { Tabs } from '../../ui/ui.tsx';

export function ConversationTabs({ value, liveCount }: { value: 'history' | 'live'; liveCount?: number }) {
  const { can } = useApp();
  if (!can('call_coach_listen') && !can('call_coach_barge')) return null;
  return (
    <div className="conv-tabs">
      <Tabs<'history' | 'live'>
        value={value}
        onChange={(v) => navigate(v === 'live' ? '#/live' : '#/calls')}
        tabs={[
          { value: 'history', label: 'Verlauf' },
          { value: 'live', label: <>Live{liveCount ? <span className="count">{liveCount}</span> : null}</> },
        ]}
      />
    </div>
  );
}
