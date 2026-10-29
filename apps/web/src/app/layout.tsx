import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthProvider } from '@/lib/auth';
import './fonts.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'wikifordummys',
  description: 'Selbst gehostetes Wiki',
  robots: { index: false, follow: false },
};

/**
 * Jede Seite wird je Anfrage gerendert, damit Next.js die CSP-Nonce aus der Middleware
 * in seine Skript-Tags übernehmen kann (S6).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await headers();
  return (
    <html lang="de">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
