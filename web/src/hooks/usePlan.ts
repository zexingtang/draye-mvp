import { useCallback, useEffect, useState } from 'react';

/**
 * 账号套餐：每日手动 Track All 额度 + 解锁的 schedule 档位。
 * 前端据此显示用量、禁用超限的按钮、锁住未解锁的档位。数据来自后端 /api/plan（读 Account tab）。
 */
export interface Plan {
  /** 每日手动 Track All 上限；null = 无限 */
  maxTrackAllPerDay: number | null;
  /** 解锁的 schedule 档位（小时） */
  allowedScheduleHours: number[];
  /** 今日已用的手动 Track All 次数 */
  trackAllUsedToday: number;
  /** 今日剩余次数；null = 无限 */
  trackAllRemaining: number | null;
}

export interface UsePlanReturn {
  plan: Plan | null;
  refetch: () => Promise<void>;
}

const DEFAULT_PLAN: Plan = {
  // 拿不到套餐时默认放开（无限 + 全档位），不因为一次读取失败就把功能锁死。
  maxTrackAllPerDay: null,
  allowedScheduleHours: [1, 2, 4, 8],
  trackAllUsedToday: 0,
  trackAllRemaining: null,
};

export function usePlan(): UsePlanReturn {
  const [plan, setPlan] = useState<Plan | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/plan');
      if (!res.ok) throw new Error(`GET /api/plan failed: ${res.status}`);
      setPlan((await res.json()) as Plan);
    } catch {
      setPlan(DEFAULT_PLAN);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { plan, refetch };
}
