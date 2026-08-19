/**
 * 这版 MVP 的数据模型。所有字段都是爬虫抓回来的，客户不能编辑、不能新增字段——
 * 只能通过 ColumnDef 控制哪些字段显示在表格里（show/hide + 排序）。
 * 跟 sheets/writer.ts 里的字段是同一份契约，改一边记得改另一边。
 */
export interface TrackingRecord {
  id: string;
  containerNumber: string;
  carrier: string;
  status: 'ACTIVE' | 'GROUNDED' | 'ERROR' | 'UNKNOWN' | 'OUTGATED';
  etaDate: string | null;
  etaTime: string | null;
  lastFreeDay: string | null;
  chassisNumber: string | null;
  lastHub: string | null;
  billYN: string | null;
  lotRowSpot: string | null;
  destinationHub: string | null;
  lockedEtnDateTime: string | null;
  unitLength: string | null;
  lastUpdated: string | null;
  /** null = 仍在追踪；非 null = 已完成/dispatch，在 History 里，Dashboard/Track All 都跳过它。 */
  completedAt: string | null;
}

export interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
  order: number;
}

/** 目前只支持 BNSF；结构上是个列表，方便以后加新 carrier */
export const SUPPORTED_CARRIERS = ['BNSF'] as const;

export function getFieldValue(record: TrackingRecord, columnKey: string): string {
  const v = (record as unknown as Record<string, unknown>)[columnKey];
  return v === null || v === undefined ? '' : String(v);
}
