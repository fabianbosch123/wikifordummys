'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FormEvent, ReactNode, useState } from 'react';
import { useAuth } from '@/lib/auth';

export function AppShell({ children }: { children: ReactNode }) {
  const { state, logout } = useAuth();
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
