'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { cacheGeneration, dropCache, readCache, writeCache } from './cache';

/**
 * Lädt Daten von der API und lädt bei Änderung des Pfads neu. path = null lädt nichts.
 * Ein bekannter Stand aus dem Zwischenspeicher erscheint sofort und wird im Hintergrund aktualisiert.
 */
export function useApiData<T>(path: string | null) {
  const [data, setState] = useState<T | null>(() => (path ? (readCache<T>(path) ?? null) : null));
  const [error, setError] = useState<ApiError | Error | null>(null);

  const reload = useCallback(async () => {
    if (!path) return;
    const since = cacheGeneration();
    try {
      const next = await api<T>(path);
      writeCache(path, next, since);
      setState(next);
      setError(null);
    } catch (err) {
      dropCache(path);
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [path]);

  useEffect(() => {
    setState(path ? (readCache<T>(path) ?? null) : null);
    void reload();
  }, [path, reload]);

  const setData = useCallback(
    (value: T | null) => {
      if (path && value !== null) writeCache(path, value);
      setState(value);
    },
    [path],
  );

  return { data, error, reload, setData };
}

/** Lädt Daten schon vorab in den Zwischenspeicher, z. B. beim Zeigen auf einen Link; Fehler bleiben still */
export function prefetchApiData(path: string) {
  if (readCache(path) !== undefined) return;
  const since = cacheGeneration();
  api(path).then(
    (value) => writeCache(path, value, since),
    () => undefined,
  );
}
