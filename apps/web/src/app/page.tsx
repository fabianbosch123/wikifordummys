'use client';

import { Card } from '@/components/ui';
import { RequireAuth } from '@/lib/auth';

export default function HomePage() {
  return (
    <RequireAuth>
      {(user) => (
        <>
          <h1>Willkommen, {user.displayName}</h1>
          <Card title="Spaces">
            <p className="muted">
              Spaces, Seitenbaum und Editor kommen mit Meilenstein 2. Bis dahin kannst du dein Profil und deine Sitzungen
              verwalten{user.isAdmin ? ' sowie Benutzer und Gruppen einladen und pflegen' : ''}.
            </p>
          </Card>
        </>
      )}
    </RequireAuth>
  );
}
