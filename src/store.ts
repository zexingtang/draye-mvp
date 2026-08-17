/**
 * 存储层——数据活在客户自己的 Google Sheet 里（见 CLAUDE.md 的核心架构原则），不在我们自己的
 * 数据库/项目里长期存客户数据。Sheet 里有三个 tab：Tracking / Columns / Account，读写细节在
 * `sheets/client.ts`。表本身用 `src/dev/setup-sheet.ts` 建一次，ID 存在 .env 的 SHEET_ID 里。
 *
 * 简化记录：曾经做过"客户自定义列 + 可复用下拉字段"这一整套（customFields/Resources），
 * 后来决定不做定制化，改成"爬虫能抓到什么字段就展示什么字段，客户只能选择显示/隐藏"——
 * 更简单，不需要 onboarding 收集列定义，也不需要维护 Resources 系统。
 */
import { overwriteRows, readRows, cellToText } from './sheets/client.js';
import { backupTab } from './backup.js';

const TRACKING_TAB = 'Tracking';
const COLUMNS_TAB = 'Columns';

/** 目前只支持 BNSF，结构上留出扩展空间——加新 carrier 时改这一个数组就够了。 */
export const SUPPORTED_CARRIERS = ['BNSF'] as const;
export type Carrier = (typeof SUPPORTED_CARRIERS)[number];

/**
 * 所有字段都是爬虫抓回来的，客户不能编辑、不能新增字段——只能通过 ColumnDef 控制
 * 哪些字段显示在表格里。
 */
export interface TrackingRecord {
  id: string;
  containerNumber: string;
  carrier: string;
  status: 'ACTIVE' | 'GROUNDED' | 'ERROR' | 'UNKNOWN';
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
  /** null = 仍在追踪；非 null = 已完成/dispatch 的时间戳，从 Track All 和 Dashboard 统计里排除，但记录本身保留在 History 里，可以 Reopen。 */
  completedAt: string | null;
}

export interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
  order: number;
}

/**
 * 固定字段集——顺序就是默认显示顺序。这份列表是权威定义，PUT /api/columns 只能改 visible/order，不能增删。
 *
 * 列名用的是通用说法，不是 BNSF 网站原文——因为以后加别的 carrier（UP/CNHAR），它们的
 * 原始字段名大概率跟 BNSF 不一样（比如"当前位置"这个概念，BNSF 叫 Last Hub，别的
 * carrier 可能叫别的），但客户看到的表格列名应该是统一的，不应该随 carrier 变。
 * 翻译成统一字段名这件事，是每个 carrier 适配器自己的责任（写进 ContainerResult.extra
 * 的时候就用统一 key），不是这张表要处理的问题——某个 carrier 没有的字段，那一列就留空。
 */
export const KNOWN_COLUMNS: ColumnDef[] = [
  { key: 'containerNumber', label: 'Container #', visible: true, order: 0 },
  { key: 'carrier', label: 'Carrier', visible: true, order: 1 },
  { key: 'status', label: 'Status', visible: true, order: 2 },
  { key: 'etaDate', label: 'ETA Date', visible: true, order: 3 },
  { key: 'etaTime', label: 'ETA Time', visible: true, order: 4 },
  { key: 'lastFreeDay', label: 'LFD', visible: true, order: 5 },
  { key: 'destinationHub', label: 'Destination', visible: true, order: 6 },
  { key: 'lastHub', label: 'Current Location', visible: false, order: 7 },
  { key: 'lotRowSpot', label: 'Yard Location', visible: true, order: 8 },
  { key: 'chassisNumber', label: 'Chassis #', visible: false, order: 9 },
  { key: 'unitLength', label: 'Unit Length', visible: false, order: 10 },
  // BNSF 页面原始展示是 "Bill Y/N"；查过 BNSF 自己 API 文档里对应的是 fullBilledIndicator（是否已完成计费/放行前置条件），
  // 改成 "Billing Complete" 是这个概念的通用叫法，不是 BNSF 黑话。
  { key: 'billYN', label: 'Billing Complete', visible: false, order: 11 },
  { key: 'lockedEtnDateTime', label: 'Locked ETN Date Time', visible: false, order: 12 },
  { key: 'lastUpdated', label: 'Last Updated', visible: true, order: 13 },
];

/** 跟 `setup-sheet.ts` 里 TRACKING_HEADERS 的列顺序必须一致——这里是唯一的读写入口，改列就两边一起改。 */
function rowToRecord(row: unknown[]): TrackingRecord {
  return {
    id: cellToText(row[0])!,
    containerNumber: cellToText(row[1])!,
    carrier: cellToText(row[2])!,
    status: (cellToText(row[3]) ?? 'UNKNOWN') as TrackingRecord['status'],
    etaDate: cellToText(row[4]),
    etaTime: cellToText(row[5]),
    lastFreeDay: cellToText(row[6]),
    chassisNumber: cellToText(row[7]),
    lastHub: cellToText(row[8]),
    billYN: cellToText(row[9]),
    lotRowSpot: cellToText(row[10]),
    destinationHub: cellToText(row[11]),
    lockedEtnDateTime: cellToText(row[12]),
    unitLength: cellToText(row[13]),
    lastUpdated: cellToText(row[14]),
    completedAt: cellToText(row[15]),
  };
}

function recordToRow(r: TrackingRecord): unknown[] {
  return [
    r.id,
    r.containerNumber,
    r.carrier,
    r.status,
    r.etaDate ?? '',
    r.etaTime ?? '',
    r.lastFreeDay ?? '',
    r.chassisNumber ?? '',
    r.lastHub ?? '',
    r.billYN ?? '',
    r.lotRowSpot ?? '',
    r.destinationHub ?? '',
    r.lockedEtnDateTime ?? '',
    r.unitLength ?? '',
    r.lastUpdated ?? '',
    r.completedAt ?? '',
  ];
}

export async function loadRecords(): Promise<TrackingRecord[]> {
  const rows = await readRows(TRACKING_TAB);
  return rows.filter((row) => row[0]).map(rowToRecord);
}

export async function saveRecords(records: TrackingRecord[]): Promise<void> {
  const rows = records.map(recordToRow);
  await overwriteRows(TRACKING_TAB, rows);
  // fire-and-forget——备份写入慢/失败不能拖慢或搞挂客户这次操作，backup.ts 自己兜底记日志报警。
  void backupTab(TRACKING_TAB, rows);
}

function rowToColumn(row: unknown[]): ColumnDef {
  return {
    key: cellToText(row[0])!,
    label: cellToText(row[1])!,
    visible: row[2] === true,
    order: typeof row[3] === 'number' ? row[3] : Number(row[3]) || 0,
  };
}

function columnToRow(c: ColumnDef): unknown[] {
  return [c.key, c.label, c.visible, c.order];
}

export async function loadColumns(): Promise<ColumnDef[]> {
  const rows = await readRows(COLUMNS_TAB);
  return rows.filter((row) => row[0]).map(rowToColumn);
}

export async function saveColumns(columns: ColumnDef[]): Promise<void> {
  const rows = columns.map(columnToRow);
  await overwriteRows(COLUMNS_TAB, rows);
  void backupTab(COLUMNS_TAB, rows);
}
