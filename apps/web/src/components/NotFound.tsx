import { TRASH_RETENTION_DAYS } from '@wiki/shared';
import Link from 'next/link';

/**
 * Deutsche „Nicht gefunden“-Seite mit Weg zurück: für unbekannte Adressen (app/not-found.tsx)
 * und für Seiten, die es nicht (mehr) gibt oder die man nicht sehen darf. Die API unterscheidet
 * diese Fälle bewusst nicht, deshalb nennt der Text alle Möglichkeiten.
 */
const TITLES = { address: 'Diese Adresse gibt es nicht', page: 'Seite nicht gefunden', space: 'Space nicht gefunden' } as const;

export function NotFound({ kind = 'address' }: { kind?: keyof typeof TITLES }) {
  return (
    <section className="not-found narrow" data-testid="not-found">
      <h1>{TITLES[kind]}</h1>
      {kind === 'page' ? (
        <p>
          Die Seite wurde gelöscht, verschoben, oder du hast keinen Zugriff darauf. Gelöschte Seiten liegen {TRASH_RETENTION_DAYS} Tage
          im Papierkorb ihres Space; Space-Admins können sie dort wiederherstellen.
        </p>
      ) : kind === 'space' ? (
        <p>Diesen Space gibt es nicht, oder du hast keinen Zugriff darauf. Frag im Zweifel die Space-Admins oder die Administration.</p>
      ) : (
        <p>Vielleicht ist der Link veraltet oder falsch abgetippt.</p>
      )}
      <form action="/search" method="get" role="search" className="row">
        <label htmlFor="not-found-q" className="visually-hidden">
          Im Wiki suchen
        </label>
        <input id="not-found-q" name="q" type="search" placeholder="Im Wiki suchen …" required maxLength={200} />
        <button type="submit" className="secondary">
          Suchen
        </button>
      </form>
      <p>
        <Link className="button" href="/">
          Zur Startseite
        </Link>
      </p>
    </section>
  );
}
