import { useCallback, useEffect, useState } from 'react';
import type { ColumnDef } from '../types/tracking';

export interface UseColumnsReturn {
  columns: ColumnDef[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** 传完整的新列表（含改过的 visible/order，或增删过自定义列）；系统列校验在后端做，失败会 throw */
  saveColumns: (next: ColumnDef[]) => Promise<void>;
}

export function useColumns(): UseColumnsReturn {
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/columns');
      if (!res.ok) throw new Error(`GET /api/columns failed: ${res.status}`);
      setColumns(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load columns');
    } finally {
      setLoading(false);
    }
  }, []);

  const saveColumns = useCallback(async (next: ColumnDef[]) => {
    const res = await fetch('/api/columns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error || `PUT /api/columns failed: ${res.status}`);
    }
    setColumns(await res.json());
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { columns, loading, error, refetch, saveColumns };
}
