'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FormEvent, ReactNode, useState } from 'react';
import type { ThemePreference } from '@wiki/shared';
import { useAuth } from '@/lib/auth';
import { THEME_LABELS } from '@/lib/theme';

/** Umschalter in der Kopfzeile: System → Hell → Dunkel → System */
const NEXT_THEME: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICONS: Record<ThemePreference, ReactNode> = {
  system: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2v14a7 7 0 0 1 0-14z" />,
  light: (
    <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z" />
  ),
  dark: <path d="M14.5 2.5a9.5 9.5 0 1 0 7 15.9A8 8 0 0 1 14.5 2.5z" />,
};

export function AppShell({ children }: { children: ReactNode }) {
  const { state, logout, setTheme } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const user = state?.authenticated ? state.user : null;
  const [query, setQuery] = useState('');

  function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?${new URLSearchParams({ q: query.trim() })}`);
    setQuery('');
  }

  const link = (href: string, label: string) => (
    <Link href={href} className={pathname === href || (href !== '/' && pathname.startsWith(href)) ? 'active' : ''}>
      {label}
    </Link>
  );

  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          wikifordummys
        </Link>
        {user && (
          <nav>
            <form className="search" role="search" onSubmit={search}>
              <label htmlFor="topbar-search" className="visually-hidden">
                Wiki durchsuchen
              </label>
              <input
                id="topbar-search"
                type="search"
                placeholder="Suchen …"
                maxLength={200}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </form>
            {link('/', 'Start')}
            {link('/profile', 'Profil')}
            {user.isAdmin && link('/admin/users', 'Administration')}
            <button
              className="link theme-toggle"
              title={`Darstellung: ${THEME_LABELS[user.theme]} – wechseln zu ${THEME_LABELS[NEXT_THEME[user.theme]]}`}
              aria-label={`Darstellung: ${THEME_LABELS[user.theme]}, wechseln zu ${THEME_LABELS[NEXT_THEME[user.theme]]}`}
              onClick={() => setTheme(NEXT_THEME[user.theme]).catch(() => undefined)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                {THEME_ICONS[user.theme]}
              </svg>
            </button>
            <button
              className="link"
              onClick={async () => {
                await logout();
                router.replace('/login');
              }}
            >
              Abmelden
            </button>
          </nav>
        )}
      </header>
      <main>{children}</main>
    </>
  );
}
