'use client';

import type { MeDto, SessionStateDto, ThemePreference } from '@wiki/shared';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { applyTheme } from './theme';
import { clearAllDrafts } from './unsaved';

interface AuthState {
  state: SessionStateDto | null;
  refresh: () => Promise<SessionStateDto>;
  logout: () => Promise<void>;
  /** Darstellung im Konto speichern und sofort anwenden */
  setTheme: (theme: ThemePreference) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionStateDto | null>(null);

  const refresh = useCallback(async () => {
    const next = await api<SessionStateDto>('/auth/session');
    setState(next);
    return next;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setState({ authenticated: false, stage: null, user: null });
    // Entwürfe enthalten Seiteninhalte; nach dem Abmelden soll an diesem Browser nichts davon übrig bleiben
    clearAllDrafts();
    // Die Darstellung gehört zum Konto; der nächste Benutzer an diesem Browser startet mit der System-Einstellung
    applyTheme('system');
  }, []);

  const setTheme = useCallback(
    async (theme: ThemePreference) => {
      const previous = state?.user?.theme ?? 'system';
      const show = (t: ThemePreference) => setState((prev) => (prev?.user ? { ...prev, user: { ...prev.user, theme: t } } : prev));
      // Sofort anzeigen, bei Fehler zurück
      show(theme);
      try {
        await api<MeDto>('/me/theme', { method: 'PUT', body: { theme } });
      } catch (err) {
        show(previous);
        throw err;
      }
    },
    [state?.user?.theme],
  );

  useEffect(() => {
    refresh().catch(() => setState({ authenticated: false, stage: null, user: null }));
  }, [refresh]);

  // Nach der Anmeldung gilt die im Konto gespeicherte Darstellung, auch auf einem neuen Gerät
  const theme = state?.user?.theme;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  return <AuthContext.Provider value={{ state, refresh, logout, setTheme }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth außerhalb von AuthProvider');
  return ctx;
}

/** Ziel nach einem Anmeldeschritt, abhängig von der Stufe der Sitzung */
export function pathForStage(stage: SessionStateDto['stage']): string {
  if (stage === 'password') return '/login/2fa';
  if (stage === 'totp_setup') return '/setup-2fa';
  if (stage === 'full') return '/';
  return '/login';
}

/** Zeigt Inhalte nur mit vollständiger Anmeldung (inklusive 2FA). */
export function RequireAuth({ admin, children }: { admin?: boolean; children: (user: MeDto) => ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!state) return;
    if (!state.authenticated) {
      const target = pathForStage(state.stage);
      // Nach der Anmeldung zurück zur ursprünglich aufgerufenen Seite, samt Parametern (z. B. OAuth-Zustimmung)
      const keepNext = pathname !== '/' && target !== '/setup-2fa';
      const next = pathname + window.location.search;
      router.replace(keepNext ? `${target}?next=${encodeURIComponent(next)}` : target);
    } else if (state.user?.mustChangePassword && pathname !== '/profile') {
      // Startpasswort aus der Kommandozeile: erst ändern, dann weiter
      router.replace('/profile');
    }
  }, [state, router, pathname]);

  if (!state || !state.authenticated || !state.user) return <p className="muted">Lade …</p>;
  if (state.user.mustChangePassword && pathname !== '/profile') return <p className="muted">Lade …</p>;
  if (admin && !state.user.isAdmin) return <p className="alert error">Dieser Bereich ist Administratoren vorbehalten.</p>;
  return <>{children(state.user)}</>;
}
