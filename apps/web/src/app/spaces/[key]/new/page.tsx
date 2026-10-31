'use client';

import { EMPTY_DOC, type PageDto } from '@wiki/shared';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { resolveUploads, uploadPending } from '@/components/editor/uploads';
import { PageForm } from '@/components/PageForm';
import { SpaceLayout } from '@/components/SpaceLayout';
import { api, errorMessage } from '@/lib/api';
import { Alert } from '@/components/ui';
import { RequireAuth } from '@/lib/auth';
import { siblingTitles } from '@/lib/tree';

function NewPage() {
  const { key } = useParams<{ key: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const requestedParent = params.get('parent');

  return (
    <SpaceLayout spaceKey={key}>
      {(space, tree) => {
        // Wie beim Bearbeiten gleich beim Laden prüfen, nicht erst beim Anlegen
        if (!space.canEdit) {
          return <Alert>{space.status === 'archived' ? 'Der Space ist archiviert, hier lassen sich keine Seiten anlegen.' : 'Du kannst hier keine Seiten anlegen.'}</Alert>;
        }
        const parent = tree.find((n) => n.id === requestedParent) ?? tree.find((n) => n.id === space.homePageId) ?? null;
        return (
          <>
            <h1>Neue Seite</h1>
            <p className="muted">{parent ? `Unterseite von „${parent.title}“` : 'Oberste Ebene des Spaces'}</p>
            <PageForm
              initialTitle=""
              initialContent={EMPTY_DOC}
              tree={tree}
              siblingTitles={siblingTitles(tree, parent?.id ?? null)}
              draftScope={`new:${space.key}:${parent?.id ?? 'root'}`}
              submitLabel="Seite anlegen"
              onCancel={() => router.push(parent ? `/pages/${parent.id}` : `/spaces/${space.key}`)}
              onSubmit={async (title, content, _force, files) => {
                // Anhänge brauchen eine Seite: erst ohne die eingefügten Dateien anlegen, dann hochladen und einsetzen
                const page = await api<PageDto>('/pages', {
                  method: 'POST',
                  body: { spaceKey: space.key, parentId: parent?.id, title, content: files.size ? resolveUploads(content, new Map()) : content },
                });
                if (files.size) {
                  try {
                    const result = await uploadPending(page.id, content, files);
                    await api(`/pages/${page.id}`, { method: 'PUT', body: { title, content: result.content, version: page.version } });
                    if (result.failed.length) window.alert(`Die Seite ist angelegt, aber nicht alle Dateien wurden eingefügt:\n${result.failed.join('\n')}`);
                  } catch (err) {
                    window.alert(`Die Seite ist angelegt, aber die Dateien wurden nicht eingefügt: ${errorMessage(err)}`);
                  }
                }
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
