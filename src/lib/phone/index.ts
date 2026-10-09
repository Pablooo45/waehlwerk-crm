import type { DemoStore } from '../store/demoStore.ts';
import type { Store } from '../store/types.ts';
import type { Phone } from './types.ts';

export type { Phone } from './types.ts';

export async function createPhone(
  store: Store,
  userId: () => string | null,
  onError: (msg: string, details?: Record<string, unknown>) => void,
): Promise<Phone> {
  if (store.mode === 'demo') {
    const { DemoPhone } = await import('./demoPhone.ts');
    return new DemoPhone(store as unknown as DemoStore, userId);
  }
  if (!__DEMO_BUILD__) {
    const { TwilioPhone } = await import('./twilioPhone.ts');
    return new TwilioPhone(store, onError);
  }
  throw new Error('Kein Telefon verfügbar.');
}
