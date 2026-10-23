'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

/** Lädt Daten von der API und lädt bei Änderung des Pfads neu. path = null lädt nichts. */
export function useApiData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [path]);

  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);

  return { data, error, reload, setData };
}
