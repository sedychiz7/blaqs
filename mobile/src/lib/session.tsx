import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { api, getToken, setToken } from './api';
import { registerPushToken } from './push';
import { connect, disconnect, subscribe, type RealtimeMessage } from './realtime';
import { stopTracking, syncTracking } from './tracking';
import type { Me } from './types';

const ONBOARDED_KEY = 'blaqs.onboarded';

interface Session {
  ready: boolean;
  me: Me | null;
  onboarded: boolean;
  refreshMe: () => Promise<Me | null>;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  finishOnboarding: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const meRef = useRef(me);
  meRef.current = me;

  const refreshMe = useCallback(async () => {
    if (!(await getToken())) {
      setMe(null);
      return null;
    }
    try {
      const next = await api<Me>('/me');
      setMe(next);
      await syncTracking(next.collect);
      return next;
    } catch (err: any) {
      if (err?.status === 401) {
        await setToken(null);
        setMe(null);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      setOnboarded((await SecureStore.getItemAsync(ONBOARDED_KEY)) === '1');
      const current = await refreshMe();
      if (current) {
        connect();
        registerPushToken().catch(() => {});
      }
      setReady(true);
    })();
  }, [refreshMe]);

  useEffect(
    () =>
      subscribe((msg: RealtimeMessage) => {
        if (msg.type === 'sharing_changed') {
          void syncTracking(msg.collect);
          void refreshMe();
        }
      }),
    [refreshMe],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && meRef.current) void refreshMe();
    });
    return () => sub.remove();
  }, [refreshMe]);

  const signIn = useCallback(
    async (token: string) => {
      await setToken(token);
      await refreshMe();
      connect();
      registerPushToken().catch(() => {});
    },
    [refreshMe],
  );

  const signOut = useCallback(async () => {
    await api('/auth/signout', { body: {} }).catch(() => {});
    await stopTracking();
    disconnect();
    await setToken(null);
    setMe(null);
  }, []);

  const finishOnboarding = useCallback(async () => {
    await SecureStore.setItemAsync(ONBOARDED_KEY, '1');
    setOnboarded(true);
  }, []);

  return (
    <SessionContext.Provider value={{ ready, me, onboarded, refreshMe, signIn, signOut, finishOnboarding }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** Re-runs `load` on mount and whenever a matching realtime message arrives. */
export function useLive<T>(load: () => Promise<T>, types: RealtimeMessage['type'][]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const key = types.join(',');

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void reload();
    const wanted = new Set(key.split(','));
    return subscribe((msg) => {
      if (wanted.has(msg.type)) void reload();
    });
  }, [reload, key]);

  return { data, error, reload, setData };
}
