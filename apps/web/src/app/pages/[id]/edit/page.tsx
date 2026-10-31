'use client';

import type { PageDto } from '@wiki/shared';
import { useParams, useRouter } from 'next/navigation';
import { useRef } from 'react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { PageForm } from '@/components/PageForm';
import { SpaceLayout } from '@/components/SpaceLayout';
import { Alert } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { useApiData } from '@/lib/data';
import { siblingTitles } from '@/lib/tree';

function EditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const page = useApiData<PageDto>(`/pages/${id}`);
  // Version, auf der die Bearbeitung beruht; nach „Trotzdem speichern“ die neueste
  const baseVersion = useRef<number | null>(null);

  if (page.error) return <Alert>{errorMessage(page.error)}</Alert>;
  if (!page.data) return <p className="muted">Lade …</p>;
  const p = page.data;
  if (!p.canEdit) return <Alert>Du kannst diese Seite nicht bearbeiten.</Alert>;
  baseVersion.current ??= p.version;

  return (
    <SpaceLayout spaceKey={p.spaceKey} currentId={p.id}>
      {(_space, tree) => (
        <>
          <Breadcrumbs page={p} current="Bearbeiten" />
          <PageForm
            initialTitle={p.title}
            initialContent={p.content}
            tree={tree}
            siblingTitles={siblingTitles(tree, p.parentId, p.id)}
            pageId={p.id}
            submitLabel="Speichern"
            onCancel={() => router.push(`/pages/${p.id}`)}
            onSubmit={async (title, content, force) => {
              if (force) {
                const current = await api<PageDto>(`/pages/${p.id}`);
                baseVersion.current = current.version;
              }
              await api(`/pages/${p.id}`, { method: 'PUT', body: { title, content, version: baseVersion.current } });
              router.push(`/pages/${p.id}`);
            }}
          />
        </>
      )}
    </SpaceLayout>
  );
}

export default function Page() {
  return <RequireAuth>{() => <EditPage />}</RequireAuth>;
}
