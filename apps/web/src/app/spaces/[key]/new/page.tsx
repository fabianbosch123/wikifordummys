'use client';

import { EMPTY_DOC, type PageDto } from '@wiki/shared';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PageForm } from '@/components/PageForm';
import { SpaceLayout } from '@/components/SpaceLayout';
import { api } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';

function NewPage() {
  const { key } = useParams<{ key: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const requestedParent = params.get('parent');

  return (
    <SpaceLayout spaceKey={key}>
      {(space, tree) => {
        const parent = tree.find((n) => n.id === requestedParent) ?? tree.find((n) => n.id === space.homePageId) ?? null;
        return (
          <>
            <h1>Neue Seite</h1>
            <p className="muted">{parent ? `Unterseite von „${parent.title}“` : 'Oberste Ebene des Spaces'}</p>
            <PageForm
              initialTitle=""
              initialContent={EMPTY_DOC}
              tree={tree}
              submitLabel="Seite anlegen"
              onCancel={() => router.push(parent ? `/pages/${parent.id}` : `/spaces/${space.key}`)}
              onSubmit={async (title, content) => {
                const page = await api<PageDto>('/pages', {
                  method: 'POST',
                  body: { spaceKey: space.key, parentId: parent?.id, title, content },
                });
                router.push(`/pages/${page.id}`);
              }}
            />
          </>
        );
      }}
    </SpaceLayout>
  );
}

export default function Page() {
  return (
    <RequireAuth>
      {() => (
        <Suspense>
          <NewPage />
        </Suspense>
      )}
    </RequireAuth>
  );
}
