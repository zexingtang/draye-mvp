import { useCallback, useEffect, useState } from 'react';
import type { TrackingRecord } from '../types/tracking';

/**
 * 对应旧仓库的 custom/hooks/useTrackingRecords.ts，但去掉了 orders/trips/invoices
 * 关联（这版不做 Dispatch/Invoice）。接的是真后端（src/server.ts）。
 *
 * 没有编辑/导入功能——这版数据全部来自爬虫，客户不能手动改字段，也不支持批量导入。
 */

export interface AddContainersResult {
  added: number;
  reactivated: number;
  duplicates: string[];
}

export interface UseTrackingRecordsReturn {
  records: TrackingRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  triggerTrackAll: () => Promise<void>;
  tracking: boolean;
  addContainers: (containerNumbers: string[], carrier: string) => Promise<AddContainersResult>;
  adding: boolean;
  // 行级操作一律传记录 id（不是箱号）——OUTGATED 归档后同号可能有两条记录，按箱号会误伤。
  deleteRecord: (id: string) => Promise<void>;
  completeRecord: (id: string) => Promise<void>;
  reopenRecord: (id: string) => Promise<void>;
  batchDeleteRecords: (ids: string[]) => Promise<number>;
  batchCompleteRecords: (ids: string[]) => Promise<number>;
}

export function useTrackingRecords(): UseTrackingRecordsReturn {
  const [records, setRecords] = useState<TrackingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [adding, setAdding] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tracking');
      if (!res.ok) throw new Error(`GET /api/tracking failed: ${res.status}`);
      setRecords(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tracking records');
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerTrackAll = useCallback(async () => {
    setTracking(true);
    setError(null);
    try {
      const res = await fetch('/api/tracking/trigger', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error || `POST /api/tracking/trigger failed: ${res.status}`);
      }
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Track All failed');
    } finally {
      setTracking(false);
    }
  }, [refetch]);

  /**
   * 批量新加入要追踪的箱号。只是登记（状态 UNKNOWN），真正拿到数据要等下一次
   * Track All（手动或定时触发）——不为新加的箱号单独造一套立即抓取逻辑。
   *
   * 已经在追踪中的箱号算真正的重复，跳过；已完成(dispatch)的箱号再次添加，
   * 视为"重新激活"（从 History 挪回 Tracking），不当作重复处理。
   */
  const addContainers = useCallback(
    async (containerNumbers: string[], carrier: string): Promise<AddContainersResult> => {
      setAdding(true);
      try {
        const duplicates: string[] = [];
        const toSend: string[] = [];
        const seen = new Set<string>();

        for (const raw of containerNumbers) {
          const cno = raw.trim().toUpperCase();
          if (!cno || seen.has(cno)) continue;
          seen.add(cno);
          // "已经在追踪中"（存在未完成的记录）才算真正的重复、跳过。只剩已完成/OUTGATED
          // 历史记录的话不算重复——那要么是重新激活、要么是全新一票货，都交给后端处理。
          const activeExisting = records.some(
            (r) => r.containerNumber.toUpperCase() === cno && !r.completedAt
          );
          if (activeExisting) {
            duplicates.push(cno);
            continue;
          }
          toSend.push(cno);
        }

        let added = 0;
        let reactivated = 0;
        if (toSend.length > 0) {
          const res = await fetch('/api/tracking/containers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ containerNumbers: toSend, carrier }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}) as { error?: string });
            throw new Error(body.error || `POST /api/tracking/containers failed: ${res.status}`);
          }
          const result = (await res.json()) as { added: number; reactivated: number };
          added = result.added;
          reactivated = result.reactivated;
        }

        await refetch();
        return { added, reactivated, duplicates };
      } finally {
        setAdding(false);
      }
    },
    [records, refetch]
  );

  const deleteRecord = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tracking/records/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`DELETE /api/tracking/records failed: ${res.status}`);
      await refetch();
    },
    [refetch]
  );

  const completeRecord = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tracking/records/${encodeURIComponent(id)}/complete`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`POST .../complete failed: ${res.status}`);
      await refetch();
    },
    [refetch]
  );

  const reopenRecord = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tracking/records/${encodeURIComponent(id)}/reopen`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`POST .../reopen failed: ${res.status}`);
      await refetch();
    },
    [refetch]
  );

  /** 批量操作——一次请求改完所有选中的箱号，不是循环调单条接口（避免并发读改存互相覆盖，见 server.ts 注释）。 */
  const batchDeleteRecords = useCallback(
    async (ids: string[]): Promise<number> => {
      const res = await fetch('/api/tracking/records/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error || `POST batch-delete failed: ${res.status}`);
      }
      const result = (await res.json()) as { deleted: number };
      await refetch();
      return result.deleted;
    },
    [refetch]
  );

  const batchCompleteRecords = useCallback(
    async (ids: string[]): Promise<number> => {
      const res = await fetch('/api/tracking/records/batch-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error || `POST batch-complete failed: ${res.status}`);
      }
      const result = (await res.json()) as { completed: number };
      await refetch();
      return result.completed;
    },
    [refetch]
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    records,
    loading,
    error,
    refetch,
    triggerTrackAll,
    tracking,
    addContainers,
    adding,
    deleteRecord,
    completeRecord,
    reopenRecord,
    batchDeleteRecords,
    batchCompleteRecords,
  };
}
