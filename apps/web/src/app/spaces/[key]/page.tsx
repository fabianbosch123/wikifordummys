'use client';

import type { SpaceDto } from '@wiki/shared';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { NotFound } from '@/components/NotFound';
import { Alert } from '@/components/ui';
import { errorMessage, isNotFound } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { useApiData } from '@/lib/data';

/** /spaces/IT leitet auf die Startseite des Spaces weiter */
function SpaceRedirect() {
  const { key } = useParams<{ key: string }>();
  const router = useRouter();
  const space = useApiData<SpaceDto>(`/spaces/${encodeURIComponent(key)}`);

  useEffect(() => {
    if (space.data?.homePageId) router.replace(`/pages/${space.data.homePageId}`);
  }, [space.data, router]);

  if (isNotFound(space.error)) return <NotFound kind="space" />;
  if (space.error) return <Alert>{errorMessage(space.error)}</Alert>;
  return <p className="muted">Lade …</p>;
}

export default function SpacePage() {
  return <RequireAuth>{() => <SpaceRedirect />}</RequireAuth>;
}
