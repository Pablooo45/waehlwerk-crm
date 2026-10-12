// Verständliche Fehlerfälle: Internet weg, Absturz einer Seite.

import { WifiOff } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from 'react';
import { bus, type BusEvent } from '../lib/bus.ts';

/** Ist der Browser online? (wechselt mit den Ereignissen „online“/„offline“) */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

const REFRESH: BusEvent[] = ['ref', 'leads', 'lead', 'tasks', 'calls', 'meetings', 'opportunities', 'timeline', 'notifications', 'comments', 'messages'];

/** Hinweis oben, solange keine Verbindung besteht; danach alles neu laden */
export function OfflineBanner() {
  const online = useOnline();
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      REFRESH.forEach((e) => bus.emit(e));
    }
  }, [online]);
  if (online) return null;
  return (
    <div className="demo-banner offline-banner" role="alert">
      <WifiOff size={15} aria-hidden="true" />
      <span className="grow">Keine Internetverbindung. Bis sie wieder da ist, wird nichts gespeichert und Anrufe sind nicht möglich.</span>
    </div>
  );
}

/** Fängt Abstürze einer Seite ab: verständlicher Hinweis statt weißer Seite, Fehler wird protokolliert */
export class CrashGuard extends Component<{ children: ReactNode; onError?: (message: string, details: Record<string, unknown>) => void; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(`Seite abgestürzt: ${error.message}`, { stack: (info.componentStack ?? '').slice(0, 1500), page: location.hash });
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // andere Seite geöffnet: neuer Versuch
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center" style={{ minHeight: '60vh', padding: 16 }}>
        <div className="section" style={{ maxWidth: 520 }}>
          <h2>Hier ist etwas schiefgegangen</h2>
          <p className="muted mt-8">
            Die Seite konnte nicht angezeigt werden. Der Fehler wurde gespeichert (Einstellungen → Diagnose). Meist hilft neu laden.
          </p>
          <p className="xs muted mt-8">{this.state.error.message}</p>
          <div className="row mt-16">
            <button type="button" className="btn primary" onClick={() => location.reload()}>Neu laden</button>
            <a className="btn" href="#/inbox" onClick={() => this.setState({ error: null })}>Zur Inbox</a>
          </div>
        </div>
      </div>
    );
  }
}
