import type { PageDto } from '@wiki/shared';
import Link from 'next/link';

export function Breadcrumbs({ page, current }: { page: PageDto; current?: string }) {
  return (
    <nav aria-label="Brotkrumen" className="breadcrumbs">
      <Link href={`/spaces/${page.spaceKey}`}>{page.spaceKey}</Link>
      {page.ancestors.map((a) => (
        <span key={a.id}>
          {' / '}
          <Link href={`/pages/${a.id}`}>{a.title}</Link>
        </span>
      ))}
      {current && <span> / {current}</span>}
    </nav>
  );
}
