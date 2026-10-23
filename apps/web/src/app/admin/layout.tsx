'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { RequireAuth } from '@/lib/auth';

const TABS = [
  { href: '/admin/users', label: 'Benutzer' },
  { href: '/admin/groups', label: 'Gruppen' },
  { href: '/admin/mail', label: 'E-Mail' },
  { href: '/admin/audit', label: 'Audit-Log' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <RequireAuth admin>
      {() => (
        <>
          <h1>Administration</h1>
          <nav className="tabs">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} className={pathname.startsWith(t.href) ? 'active' : ''}>
                {t.label}
              </Link>
            ))}
          </nav>
          {children}
        </>
      )}
    </RequireAuth>
  );
}
