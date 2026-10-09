import { config } from '../config.ts';
import type { Store } from './types.ts';

export type { Store } from './types.ts';

export async function createStore(): Promise<Store> {
  if (config.demo) {
    const { DemoStore } = await import('./demoStore.ts');
    return new DemoStore();
  }
  if (!__DEMO_BUILD__) {
    const { SupabaseStore } = await import('./supabaseStore.ts');
    return new SupabaseStore();
  }
  throw new Error('Keine Datenquelle konfiguriert.');
}
