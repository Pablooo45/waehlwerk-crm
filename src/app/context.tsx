import { createContext, type ReactNode, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { bus } from '../lib/bus.ts';
import type { Phone } from '../lib/phone/types.ts';
import type { DialRequest, PhoneSnapshot } from '../lib/phone/types.ts';
import { hasPerm, isAdmin } from '../lib/perms.ts';
import type { Store } from '../lib/store/types.ts';
import type { Permission, Profile, RefData } from '../lib/types.ts';
import { errMsg, useUi } from '../ui/ui.tsx';
import { navigate } from './router.ts';

export interface AppApi {
  store: Store;
  ref: RefData;
  me: Profile;
  phone: Phone;
  isAdmin: boolean;
  can: (p: Permission) => boolean;
  demo: boolean;
  reloadRef: () => Promise<void>;
  dial: (req: DialRequest) => Promise<boolean>;
  logError: (e: unknown, context?: string) => void;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppApi | null>(null);

export function AppProvider({
  store,
  refData,
  setRefData,
  phone,
  onSignOut,
  children,
}: {
  store: Store;
  refData: RefData;
  setRefData: (r: RefData) => void;
  phone: Phone;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const { toast } = useUi();

  const reloadRef = useCallback(async () => {
    setRefData(await store.loadRef());
    bus.emit('ref');
  }, [store, setRefData]);

  const logError = useCallback(
    (e: unknown, context?: string) => {
      const message = `${context ? `${context}: ` : ''}${errMsg(e)}`;
      console.error(message, e);
      store.logClientError(message, {
        stack: e instanceof Error ? e.stack?.slice(0, 2000) : null,
        page: location.hash,
        ua: navigator.userAgent,
      });
    },
    [store],
  );

  const dial = useCallback(
    async (req: DialRequest) => {
      const snap = phone.getSnapshot();
      if (snap.call) {
        toast('Es läuft schon ein Anruf.', { kind: 'error' });
        return false;
      }
      if (snap.status !== 'ready') {
        toast(snap.message || 'Das Telefon ist nicht bereit.', {
          kind: 'error',
          action: { label: 'Prüfen', run: () => navigate('#/settings/diagnose') },
        });
        return false;
      }
      try {
        await phone.dial(req);
        return true;
      } catch (e) {
        toast(errMsg(e), { kind: 'error' });
        logError(e, 'Wählen');
        return false;
      }
    },
    [phone, toast, logError],
  );

  const signOut = useCallback(async () => {
    phone.stop();
    await store.signOut();
    onSignOut();
  }, [phone, store, onSignOut]);

  const value = useMemo<AppApi>(
    () => ({
      store,
      ref: refData,
      me: refData.me,
      phone,
      isAdmin: isAdmin(refData),
      can: (p: Permission) => hasPerm(refData, p),
      demo: store.mode === 'demo',
      reloadRef,
      dial,
      logError,
      signOut,
    }),
    [store, refData, phone, reloadRef, dial, logError, signOut],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppApi {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppProvider fehlt');
  return ctx;
}

export function usePhone(): PhoneSnapshot {
  const { phone } = useApp();
  return useSyncExternalStore(
    (cb) => phone.subscribe(cb),
    () => phone.getSnapshot(),
  );
}
