import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthProvider } from '@/lib/auth';
import { THEME_COOKIE, themeAttribute } from '@/lib/theme';
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
  // Darstellung des Benutzers schon im ersten HTML, damit beim Laden nichts hell aufblitzt
  const theme = themeAttribute((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="de" data-theme={theme}>
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
