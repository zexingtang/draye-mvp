import { useCallback, useEffect, useState } from 'react';

export const SCHEDULE_HOUR_OPTIONS = [1, 2, 4, 8] as const;

export interface UseScheduleReturn {
  hours: number | null;
  enabled: boolean;
  loading: boolean;
  updating: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setSchedule: (hours: number) => Promise<void>;
  stopSchedule: () => Promise<void>;
}

/** 真正的服务器端定时任务(Cloud Scheduler)——跟浏览器 setInterval 不一样,关掉这个标签页它照样跑。 */
export function useSchedule(): UseScheduleReturn {
  const [hours, setHours] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/schedule');
      if (!res.ok) throw new Error(`GET /api/schedule failed: ${res.status}`);
      const data = await res.json();
      setHours(data.hours);
      setEnabled(data.enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  const setSchedule = useCallback(
    async (h: number) => {
      setUpdating(true);
      setError(null);
      try {
        const res = await fetch('/api/schedule', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hours: h }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}) as { error?: string });
          throw new Error(body.error || `PUT /api/schedule failed: ${res.status}`);
        }
        await refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update schedule');
      } finally {
        setUpdating(false);
      }
    },
    [refetch]
  );

  const stopSchedule = useCallback(async () => {
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch('/api/schedule', { method: 'DELETE' });
      if (!res.ok) throw new Error(`DELETE /api/schedule failed: ${res.status}`);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop schedule');
    } finally {
      setUpdating(false);
    }
  }, [refetch]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { hours, enabled, loading, updating, error, refetch, setSchedule, stopSchedule };
}
