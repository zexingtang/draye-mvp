/**
 * 临时本地存储 —— 两个 JSON 文件（tracking 数据 + 列显示配置）。
 *
 * 这不是最终方案，最终数据应该活在客户自己的 Google Sheet 里（见 CLAUDE.md 的核心架构原则）。
 * 但 Sheets 那边的 gcloud 认证还没弄好，先用这个文件把"后端真的能跑起来"这件事跑通，
 * 不卡在认证问题上。以后接 Sheets 时，只需要把这个文件里的 load / save 函数
 * 换成读写 sheets/writer.ts，server.ts 里调用这两个函数的地方完全不用改。
 *
 * 简化记录：曾经做过"客户自定义列 + 可复用下拉字段"这一整套（customFields/Resources），
 * 后来决定不做定制化，改成"爬虫能抓到什么字段就展示什么字段，客户只能选择显示/隐藏"——
 * 更简单，不需要 onboarding 收集列定义，也不需要维护 Resources 系统。
 */
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

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
  { key: 'lotRowSpot', label: 'Yard Location', visible: false, order: 8 },
  { key: 'chassisNumber', label: 'Chassis #', visible: false, order: 9 },
  { key: 'unitLength', label: 'Unit Length', visible: false, order: 10 },
  // BNSF 页面原始展示是 "Bill Y/N"；查过 BNSF 自己 API 文档里对应的是 fullBilledIndicator（是否已完成计费/放行前置条件），
  // 改成 "Billing Complete" 是这个概念的通用叫法，不是 BNSF 黑话。
  { key: 'billYN', label: 'Billing Complete', visible: false, order: 11 },
  { key: 'lockedEtnDateTime', label: 'Locked ETN Date Time', visible: false, order: 12 },
  { key: 'lastUpdated', label: 'Last Updated', visible: true, order: 13 },
];

const DATA_DIR = path.join(process.cwd(), 'data');
const TRACKING_FILE = path.join(DATA_DIR, 'tracking.json');
const COLUMNS_FILE = path.join(DATA_DIR, 'columns.json');

async function ensureFile(file: string, defaultContent: string): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(file, 'utf-8');
  } catch {
    await writeFile(file, defaultContent, 'utf-8');
  }
}

export async function loadRecords(): Promise<TrackingRecord[]> {
  await ensureFile(TRACKING_FILE, '[]');
  const raw = await readFile(TRACKING_FILE, 'utf-8');
  const records = JSON.parse(raw) as Partial<TrackingRecord>[];
  // 兼容老数据：补上新加的字段，缺的当 null
  return records.map((r) => ({
    id: r.id!,
    containerNumber: r.containerNumber!,
    carrier: r.carrier!,
    status: r.status ?? 'UNKNOWN',
    etaDate: r.etaDate ?? null,
    etaTime: r.etaTime ?? null,
    lastFreeDay: r.lastFreeDay ?? null,
    chassisNumber: r.chassisNumber ?? null,
    lastHub: r.lastHub ?? null,
    billYN: r.billYN ?? null,
    lotRowSpot: r.lotRowSpot ?? null,
    destinationHub: r.destinationHub ?? null,
    lockedEtnDateTime: r.lockedEtnDateTime ?? null,
    unitLength: r.unitLength ?? null,
    lastUpdated: r.lastUpdated ?? null,
    completedAt: r.completedAt ?? null,
  }));
}

export async function saveRecords(records: TrackingRecord[]): Promise<void> {
  await ensureFile(TRACKING_FILE, '[]');
  await writeFile(TRACKING_FILE, JSON.stringify(records, null, 2), 'utf-8');
}

export async function loadColumns(): Promise<ColumnDef[]> {
  await ensureFile(COLUMNS_FILE, JSON.stringify(KNOWN_COLUMNS, null, 2));
  const raw = await readFile(COLUMNS_FILE, 'utf-8');
  return JSON.parse(raw) as ColumnDef[];
}

export async function saveColumns(columns: ColumnDef[]): Promise<void> {
  await ensureFile(COLUMNS_FILE, '[]');
  await writeFile(COLUMNS_FILE, JSON.stringify(columns, null, 2), 'utf-8');
}
