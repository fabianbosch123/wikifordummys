'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';

export function AppShell({ children }: { children: ReactNode }) {
  const { state, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const user = state?.authenticated ? state.user : null;

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
