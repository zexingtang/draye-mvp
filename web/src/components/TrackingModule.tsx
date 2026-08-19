import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Columns3,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Play,
  RotateCcw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { ColumnDef, TrackingRecord } from '../types/tracking';
import { getFieldValue } from '../types/tracking';
import type { AddContainersResult, TrackProgress } from '../hooks/useTrackingRecords';
import type { Plan } from '../hooks/usePlan';
import { AddContainersModal } from './AddContainersModal';
import { ColumnSettingsModal } from './ColumnSettingsModal';

interface TrackingModuleProps {
  records: TrackingRecord[];
  historyRecords: TrackingRecord[];
  columns: ColumnDef[];
  loading: boolean;
  tracking: boolean;
  trackProgress: TrackProgress | null;
  plan: Plan | null;
  error: string | null;
  onTriggerTrackAll: () => Promise<void>;
  onAddContainers: (containerNumbers: string[], carrier: string) => Promise<AddContainersResult>;
  onDeleteRecord: (id: string) => Promise<void>;
  onCompleteRecord: (id: string) => Promise<void>;
  onReopenRecord: (id: string) => Promise<void>;
  onBatchDeleteRecords: (ids: string[]) => Promise<number>;
  onBatchCompleteRecords: (ids: string[]) => Promise<number>;
  onSaveColumns: (columns: ColumnDef[]) => Promise<void>;
  scheduleHours: number | null;
  scheduleEnabled: boolean;
  scheduleUpdating: boolean;
  onSetSchedule: (hours: number) => Promise<void>;
  onStopSchedule: () => Promise<void>;
}

type ViewMode = 'active' | 'history';

const SCHEDULE_OPTIONS = [1, 2, 4, 8];

// 虚拟化参数：只渲染视口内的行，上下各多渲染 OVERSCAN 行做缓冲。ROW_HEIGHT 是实测的固定行距
// （53px，含 divide-y 的 1px 边框）——所有行等高，所以固定值就够，用它算 spacer 高度和可见区间。
const ROW_HEIGHT = 53;
const OVERSCAN = 12;

/** 两条记录按某一列比大小。空值永远排最后——不管升降序，没数据的行沉底、有意义的数据浮顶。 */
function compareByEntry(a: TrackingRecord, b: TrackingRecord, key: string, dir: 'asc' | 'desc'): number {
  if (key === 'lastUpdated') {
    const at = a.lastUpdated ? new Date(a.lastUpdated).getTime() : null;
    const bt = b.lastUpdated ? new Date(b.lastUpdated).getTime() : null;
    if (!at && !bt) return 0;
    if (!at) return 1;
    if (!bt) return -1;
    return dir === 'asc' ? at - bt : bt - at;
  }
  const av = getFieldValue(a, key);
  const bv = getFieldValue(b, key);
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  const cmp = av.localeCompare(bv);
  return dir === 'asc' ? cmp : -cmp;
}

/** "0501" -> "05:01"。只处理刚好 4 位数字的情况，其他格式（已经带冒号、carrier 给的格式不一样）原样返回，不瞎改。 */
function formatEtaTime(value: string): string {
  return /^\d{4}$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : value;
}

/** LFD 是今天(或已过期) -> 'today'；明天 -> 'tomorrow'；否则不预警。日期格式跟 etaDate 一致（BNSF 给的 MM/DD/YY）。 */
function lfdUrgency(lfd: string): 'today' | 'tomorrow' | null {
  const m = lfd.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  const lfdDate = new Date(2000 + parseInt(yy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (lfdDate.getTime() <= today.getTime()) return 'today';
  if (lfdDate.getTime() === tomorrow.getTime()) return 'tomorrow';
  return null;
}

/** 单元格渲染——Tracking 和 History 两张表共用，保证状态徽章/时间格式/LFD 预警展示一致。 */
export function renderTrackingCell(col: ColumnDef, record: TrackingRecord) {
  const value = getFieldValue(record, col.key);
  if (col.key === 'status') {
    const colors: Record<string, string> = {
      ACTIVE: 'bg-green-100 text-green-700',
      GROUNDED: 'bg-red-100 text-red-700',
      ERROR: 'bg-red-100 text-red-700',
      UNKNOWN: 'bg-gray-100 text-gray-700',
      OUTGATED: 'bg-blue-100 text-blue-700',
    };
    return <span className={`px-2 py-1 rounded-md text-xs font-medium uppercase ${colors[value] || colors.UNKNOWN}`}>{value}</span>;
  }
  if (col.key === 'lastUpdated' && value) {
    const d = new Date(value);
    return <span className="text-sm text-slate-700">{Number.isNaN(d.getTime()) ? value : d.toLocaleString()}</span>;
  }
  if (col.key === 'etaTime' && value) {
    return <span className="text-sm text-slate-700">{formatEtaTime(value)}</span>;
  }
  if (col.key === 'lastFreeDay' && value) {
    const urgency = lfdUrgency(value);
    const cls =
      urgency === 'today'
        ? 'bg-red-100 text-red-700'
        : urgency === 'tomorrow'
          ? 'bg-amber-100 text-amber-700'
          : 'text-slate-700';
    return <span className={`px-2 py-1 rounded-md text-xs font-medium ${cls}`}>{value}</span>;
  }
  return <span className="text-sm text-slate-700">{value || <span className="text-slate-400">-</span>}</span>;
}

interface TrackingRowProps {
  record: TrackingRecord;
  visibleColumns: ColumnDef[];
  viewMode: ViewMode;
  isSelected: boolean;
  completing: boolean;
  deleting: boolean;
  confirmingDelete: boolean;
  reopening: boolean;
  onSetShiftHeld: (v: boolean) => void;
  onCheckboxToggle: (id: string) => void;
  onComplete: (record: TrackingRecord) => void;
  onDelete: (record: TrackingRecord) => void;
  onReopen: (record: TrackingRecord) => void;
}

/**
 * 单行——用 memo 包起来，props 全是稳定引用/基本类型。点排序时行的数据没变、只是重排，
 * memo 让这些行直接跳过重渲染（React 靠 key 移动已有 DOM），不再全表重建 2000+ 单元格。
 * 关键：不接收会随排序变化的行号 idx（区间选择的锚点在父层用 id 算），否则 memo 就失效了。
 */
const TrackingRow = memo(function TrackingRow({
  record,
  visibleColumns,
  viewMode,
  isSelected,
  completing,
  deleting,
  confirmingDelete,
  reopening,
  onSetShiftHeld,
  onCheckboxToggle,
  onComplete,
  onDelete,
  onReopen,
}: TrackingRowProps) {
  return (
    // 去掉了 transition-colors：几百行都挂过渡动画，滚动/重绘时是白白的开销（虚拟化后行数虽少，但没必要）。
    <tr className={`hover:bg-slate-50 ${isSelected ? 'bg-slate-50' : ''}`}>
      {viewMode === 'active' && (
        <td className="px-4 py-3">
          <input
            type="checkbox"
            checked={isSelected}
            onClick={(e) => onSetShiftHeld(e.shiftKey)}
            onChange={() => onCheckboxToggle(record.id)}
            className="w-4 h-4 rounded border-slate-300 text-slate-800 focus:ring-slate-500 cursor-pointer"
          />
        </td>
      )}
      {visibleColumns.map((col) => (
        <td key={col.key} className="px-4 py-3 whitespace-nowrap">
          {renderTrackingCell(col, record)}
        </td>
      ))}
      {viewMode === 'history' && (
        <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-500">
          {record.completedAt ? new Date(record.completedAt).toLocaleString() : '-'}
        </td>
      )}
      <td className="px-4 py-3 text-right">
        {viewMode === 'active' ? (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => onComplete(record)}
              disabled={completing}
              title={`Mark ${record.containerNumber} complete`}
              className="p-1.5 rounded hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors disabled:opacity-50"
            >
              {completing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            </button>
            {confirmingDelete ? (
              <button
                onClick={() => onDelete(record)}
                disabled={deleting}
                className="px-2 py-1 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Confirm?
              </button>
            ) : (
              <button
                onClick={() => onDelete(record)}
                title={`Remove ${record.containerNumber}`}
                className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => onReopen(record)}
            disabled={reopening}
            title={`Reopen ${record.containerNumber}`}
            className="p-1.5 rounded hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors disabled:opacity-50 ml-auto block"
          >
            {reopening ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
          </button>
        )}
      </td>
    </tr>
  );
});

export function TrackingModule({
  records,
  historyRecords,
  columns,
  loading,
  tracking,
  trackProgress,
  plan,
  error,
  onTriggerTrackAll,
  onAddContainers,
  onDeleteRecord,
  onCompleteRecord,
  onReopenRecord,
  onBatchDeleteRecords,
  onBatchCompleteRecords,
  onSaveColumns,
  scheduleHours,
  scheduleEnabled,
  scheduleUpdating,
  onSetSchedule,
  onStopSchedule,
}: TrackingModuleProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
  const [sortStack, setSortStack] = useState<Array<{ key: string; dir: 'asc' | 'desc' }>>([]);
  const [showScheduleMenu, setShowScheduleMenu] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchActing, setBatchActing] = useState(false);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  // 虚拟化滚动状态：scrollTop 决定渲染哪一段行，viewportH 决定一屏能放几行。
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const confirmResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const batchConfirmResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 下面几个 ref 是为了让传给 memo 化行组件的事件回调保持"引用稳定"——
  // 回调不直接闭包 sorted/confirmDeleteId（那样每次渲染都变、memo 就失效了），
  // 而是读这些"永远指向最新值"的 ref。shift 区间选择的锚点也用 id 存（不用行索引），
  // 这样排序把行重排之后锚点依然有效，也不需要给每行传会随排序变化的 idx。
  const shiftHeldRef = useRef(false);
  const lastSelectedIdRef = useRef<string | null>(null);
  const sortedRef = useRef<TrackingRecord[]>([]);
  const confirmDeleteIdRef = useRef<string | null>(null);
  confirmDeleteIdRef.current = confirmDeleteId;

  // 切到 History,或者列表刷新之后已选的箱号被删/完成了,已选状态就没意义了,清空。
  useEffect(() => {
    setSelectedIds(new Set());
    setConfirmBatchDelete(false);
  }, [viewMode]);

  /** 单击：替换整个排序栈（同一列则切换方向）。Shift+单击：在排序栈里追加列或切换已有列的方向。 */
  const handleSort = (key: string, shiftKey: boolean) => {
    setSortStack((prev) => {
      if (!shiftKey) {
        if (prev.length === 1 && prev[0].key === key) {
          return [{ key, dir: prev[0].dir === 'asc' ? 'desc' : 'asc' }];
        }
        return [{ key, dir: 'asc' }];
      }
      const existingIdx = prev.findIndex((s) => s.key === key);
      if (existingIdx !== -1) {
        const next = [...prev];
        next[existingIdx] = { key, dir: prev[existingIdx].dir === 'asc' ? 'desc' : 'asc' };
        return next;
      }
      return [...prev, { key, dir: 'asc' }];
    });
  };

  /** 点一下变成"确认删除"态（3 秒内没再点会自动取消），再点一下才真的删——不用原生 confirm()。
   * 读 confirmDeleteIdRef 而不是闭包 confirmDeleteId，回调保持引用稳定，memo 化的行才不会白重渲染。 */
  const handleDeleteClick = useCallback(
    async (record: TrackingRecord) => {
      if (confirmDeleteIdRef.current !== record.id) {
        if (confirmResetRef.current) clearTimeout(confirmResetRef.current);
        setConfirmDeleteId(record.id);
        confirmResetRef.current = setTimeout(() => setConfirmDeleteId(null), 3000);
        return;
      }
      if (confirmResetRef.current) clearTimeout(confirmResetRef.current);
      setConfirmDeleteId(null);
      setDeletingId(record.id);
      try {
        await onDeleteRecord(record.id);
      } finally {
        setDeletingId(null);
      }
    },
    [onDeleteRecord]
  );

  /** Complete 单击即完成，不需要二次确认——它很容易撤销(History 里 Reopen)，不像 Delete 那样是真的丢数据。 */
  const handleCompleteClick = useCallback(
    async (record: TrackingRecord) => {
      setCompletingId(record.id);
      try {
        await onCompleteRecord(record.id);
      } finally {
        setCompletingId(null);
      }
    },
    [onCompleteRecord]
  );

  /** Reopen 跟 Complete 一样不需要确认——本来就是"撤销"操作，不会丢数据。 */
  const handleReopenClick = useCallback(
    async (record: TrackingRecord) => {
      setReopeningId(record.id);
      try {
        await onReopenRecord(record.id);
      } finally {
        setReopeningId(null);
      }
    },
    [onReopenRecord]
  );

  // handleCheckboxClick 需要读当前 sorted，定义在 sorted 之后

  // 套餐派生标志：Track All 是否有额度限制/是否已用完；哪些 schedule 档位解锁了。
  const trackAllRemaining = plan?.trackAllRemaining ?? null;
  const trackAllLimit = plan?.maxTrackAllPerDay ?? null;
  const trackAllExhausted = trackAllLimit !== null && trackAllRemaining !== null && trackAllRemaining <= 0;
  const allowedScheduleHours = plan?.allowedScheduleHours ?? SCHEDULE_OPTIONS;

  /** Batch complete 跟单条一样不需要确认——容易撤销(History 里逐条 Reopen)。 */
  const handleBatchComplete = useCallback(async () => {
    const ids = records.filter((r) => selectedIds.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    setBatchActing(true);
    try {
      await onBatchCompleteRecords(ids);
      setSelectedIds(new Set());
    } finally {
      setBatchActing(false);
    }
  }, [records, selectedIds, onBatchCompleteRecords]);

  /** Batch delete 跟单条删除一样要二次确认（真的会丢数据），点一下进入确认态，3 秒内没再点自动取消。 */
  const handleBatchDeleteClick = useCallback(async () => {
    if (!confirmBatchDelete) {
      if (batchConfirmResetRef.current) clearTimeout(batchConfirmResetRef.current);
      setConfirmBatchDelete(true);
      batchConfirmResetRef.current = setTimeout(() => setConfirmBatchDelete(false), 3000);
      return;
    }
    if (batchConfirmResetRef.current) clearTimeout(batchConfirmResetRef.current);
    setConfirmBatchDelete(false);
    const ids = records.filter((r) => selectedIds.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    setBatchActing(true);
    try {
      await onBatchDeleteRecords(ids);
      setSelectedIds(new Set());
    } finally {
      setBatchActing(false);
    }
  }, [confirmBatchDelete, records, selectedIds, onBatchDeleteRecords]);

  // memo 化：这几个派生值只在真正的依赖变化时重算，避免每次渲染（比如勾选一行）都重新
  // 过滤/排序一遍 150+ 行——配合下面 memo 化的行组件，点排序时不会再全表重渲染。
  const visibleColumns = useMemo(
    () => [...columns].filter((c) => c.visible).sort((a, b) => a.order - b.order),
    [columns]
  );
  const sourceRecords = viewMode === 'active' ? records : historyRecords;
  const filtered = useMemo(
    () => sourceRecords.filter((r) => r.containerNumber.toLowerCase().includes(searchTerm.toLowerCase())),
    [sourceRecords, searchTerm]
  );

  const sorted = useMemo(
    () =>
      sortStack.length > 0
        ? [...filtered].sort((a, b) => {
            for (const { key, dir } of sortStack) {
              const cmp = compareByEntry(a, b, key, dir);
              if (cmp !== 0) return cmp;
            }
            return 0;
          })
        : viewMode === 'history'
          ? [...filtered].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
          : filtered,
    [filtered, sortStack, viewMode]
  );
  sortedRef.current = sorted; // 供稳定回调读取最新排序结果

  /**
   * Shift+单击：选中"上次点击那行"到"当前行"之间的整段（按当前排序顺序）。普通点击：切换单行。
   * - shift 状态用 onClick 提前记进 shiftHeldRef，真正的切换走 checkbox 原生 onChange
   *   （不在 onClick 里 preventDefault，那样会破坏受控 checkbox 的对勾刷新）。
   * - 锚点存 id 不存行号：排序把行重排后依然能正确算区间，也让回调不依赖会变的 idx，保持引用稳定。
   */
  const handleCheckboxToggle = useCallback((id: string) => {
    const cur = sortedRef.current;
    if (shiftHeldRef.current && lastSelectedIdRef.current) {
      const a = cur.findIndex((r) => r.id === lastSelectedIdRef.current);
      const b = cur.findIndex((r) => r.id === id);
      if (a !== -1 && b !== -1) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelectedIds((prev) => {
          const next = new Set(prev);
          cur.slice(from, to + 1).forEach((r) => next.add(r.id));
          return next;
        });
      }
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    lastSelectedIdRef.current = id;
  }, []);

  const setShiftHeld = useCallback((v: boolean) => {
    shiftHeldRef.current = v;
  }, []);

  // 测量滚动容器的可视高度（挂载 + 尺寸变化时），用来算一屏渲染几行。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 滚动时更新 scrollTop 决定渲染哪一段。虚拟化后只渲染约一屏（几十行），重渲染很便宜，
  // 直接 setState 即可，不用 rAF 节流——之前那套 rAF guard 有个坑：万一某次 rAF 没触发
  // （标签页切后台等），ref 会永远卡住、之后再也不更新窗口。直接 setState 简单又稳。
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // "全选"操作的是当前搜索筛选之后看得见的这些行，不是全部 active 箱号——跟大多数表格的全选习惯一致。
  const allVisibleSelected = sorted.length > 0 && sorted.every((r) => selectedIds.has(r.id));
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        sorted.forEach((r) => next.delete(r.id));
        return next;
      }
      const next = new Set(prev);
      sorted.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const extraColumnCount = (viewMode === 'active' ? 2 : 1) + (viewMode === 'history' ? 1 : 0);
  const totalColumnCount = visibleColumns.length + extraColumnCount;

  // 虚拟化窗口：只渲染当前视口附近的行，上下用等高的 spacer 行撑起总高度、保持滚动条正确。
  // viewportH 还没测到（首帧/隐藏）时用 600 兜底，先渲染一屏，测到真实高度后自动修正。
  const totalRows = sorted.length;
  const effectiveViewportH = viewportH || 600;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(totalRows, startIndex + Math.ceil(effectiveViewportH / ROW_HEIGHT) + OVERSCAN * 2);
  const visibleRecords = sorted.slice(startIndex, endIndex);
  const topPad = startIndex * ROW_HEIGHT;
  const bottomPad = Math.max(0, (totalRows - endIndex) * ROW_HEIGHT);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="sticky top-0 z-30 flex-shrink-0 bg-white border-b border-slate-200 shadow-sm">
        <div className="p-8 pb-6">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Tracking</h1>
              <p className="text-sm text-slate-600">
                {viewMode === 'active'
                  ? 'All your containers, tracked automatically — no manual lookups.'
                  : 'Completed containers. Reopen one to bring it back into active tracking.'}
              </p>
            </div>

            {viewMode === 'active' && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setAddOpen(true)}
                  className="px-4 py-2 bg-[#253047] text-white rounded-lg hover:bg-[#1e2638] transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Add Containers
                </button>

                <button
                  onClick={() => setColumnSettingsOpen(true)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  <Columns3 className="w-4 h-4" />
                  Columns
                </button>

                <div className="flex flex-col items-stretch">
                  <button
                    onClick={onTriggerTrackAll}
                    disabled={tracking || trackAllExhausted}
                    title={trackAllExhausted ? '今日 Track All 次数已用完，明天刷新' : undefined}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium"
                  >
                    {tracking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Track All
                  </button>
                  {trackAllLimit !== null && (
                    <span
                      className={`mt-1 text-center text-xs ${trackAllExhausted ? 'text-red-500 font-medium' : 'text-slate-400'}`}
                    >
                      {trackAllExhausted
                        ? `Limit reached (${trackAllLimit}/day)`
                        : `${trackAllRemaining ?? trackAllLimit}/${trackAllLimit} left today`}
                    </span>
                  )}
                </div>

                <div className="relative">
                  <button
                    onClick={() => setShowScheduleMenu(!showScheduleMenu)}
                    disabled={scheduleUpdating}
                    className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium disabled:opacity-50 ${
                      scheduleEnabled && scheduleHours
                        ? 'bg-amber-50 text-amber-700 border border-amber-300 hover:bg-amber-100'
                        : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {scheduleUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                    {scheduleEnabled && scheduleHours ? `Every ${scheduleHours}h` : 'Schedule'}
                  </button>
                  {showScheduleMenu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowScheduleMenu(false)} />
                      <div className="absolute right-0 top-10 z-20 w-52 bg-white rounded-lg shadow-lg border border-slate-200 py-1">
                        <div className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Auto-Track Interval</div>
                        {SCHEDULE_OPTIONS.map((h) => {
                          const locked = !allowedScheduleHours.includes(h);
                          if (locked) {
                            return (
                              <div
                                key={h}
                                title="请升级 Plan 解锁该频率 · Upgrade to unlock"
                                className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 text-slate-300 cursor-not-allowed select-none"
                              >
                                <Lock className="w-3.5 h-3.5" />
                                Every {h} {h === 1 ? 'hour' : 'hours'}
                                <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-300">Upgrade</span>
                              </div>
                            );
                          }
                          return (
                            <button
                              key={h}
                              onClick={() => {
                                onSetSchedule(h);
                                setShowScheduleMenu(false);
                              }}
                              disabled={scheduleUpdating}
                              className={`w-full px-4 py-2 text-left text-sm transition-colors flex items-center gap-2 disabled:opacity-50 ${
                                scheduleEnabled && scheduleHours === h ? 'bg-amber-50 text-amber-700 font-medium' : 'text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <Play className="w-3.5 h-3.5" />
                              Every {h} {h === 1 ? 'hour' : 'hours'}
                            </button>
                          );
                        })}
                        {scheduleEnabled && (
                          <>
                            <div className="my-1 border-t border-slate-200" />
                            <button
                              onClick={() => {
                                onStopSchedule();
                                setShowScheduleMenu(false);
                              }}
                              disabled={scheduleUpdating}
                              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2 disabled:opacity-50"
                            >
                              <Square className="w-3.5 h-3.5" />
                              Stop Schedule
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {viewMode === 'history' && (
              <button
                onClick={() => setColumnSettingsOpen(true)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <Columns3 className="w-4 h-4" />
                Columns
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('active')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'active' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Active ({records.length})
              </button>
              <button
                onClick={() => setViewMode('history')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                History ({historyRecords.length})
              </button>
            </div>

            <div className="flex-1 relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search container #..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>
      </div>

      {/* 这一整块自己不滚动——真正滚动的是下面表格自己那个容器，让横向滚动条永远贴在
          "看得见的表格区域"底部，不用先把两百多行滚到底才摸得到（之前的 bug）。 */}
      <div className="flex-1 min-h-0 overflow-hidden bg-slate-50 p-8 flex flex-col">
        {viewMode === 'active' && tracking && (
          <div className="mb-4 flex-shrink-0 px-4 py-3 bg-white border border-slate-200 rounded-lg">
            <div className="flex items-center justify-between mb-2 gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700 min-w-0">
                <RefreshCw className="w-4 h-4 animate-spin text-sky-600 flex-shrink-0" />
                <span className="truncate">
                  {trackProgress
                    ? `Tracking — batch ${trackProgress.batchesDone}/${trackProgress.totalBatches} · ${trackProgress.processed}/${trackProgress.total} containers`
                    : 'Starting tracking…'}
                </span>
              </div>
              {trackProgress && (
                <div className="flex items-center gap-3 text-xs flex-shrink-0">
                  <span className="text-emerald-600 font-medium">{trackProgress.found} found</span>
                  <span className="text-slate-400">{trackProgress.notFound} not found</span>
                  {trackProgress.errored > 0 && (
                    <span className="text-red-600 font-medium">{trackProgress.errored} error</span>
                  )}
                </div>
              )}
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all duration-300"
                style={{
                  width:
                    trackProgress && trackProgress.total > 0
                      ? `${Math.round((trackProgress.processed / trackProgress.total) * 100)}%`
                      : '8%',
                }}
              />
            </div>
          </div>
        )}
        {viewMode === 'active' && selectedIds.size > 0 && (
          <div className="mb-4 flex-shrink-0 flex items-center gap-3 px-4 py-2.5 bg-slate-800 text-white rounded-lg">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <div className="flex-1" />
            <button
              onClick={handleBatchComplete}
              disabled={batchActing}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium flex items-center gap-1.5"
            >
              {batchActing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Complete
            </button>
            <button
              onClick={handleBatchDeleteClick}
              disabled={batchActing}
              className={`px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors text-sm font-medium flex items-center gap-1.5 ${
                confirmBatchDelete ? 'bg-red-600 hover:bg-red-700' : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              {batchActing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {confirmBatchDelete ? 'Confirm delete?' : 'Delete'}
            </button>
            <button
              onClick={() => {
                setSelectedIds(new Set());
                setConfirmBatchDelete(false);
              }}
              title="Clear selection"
              className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 bg-white rounded-lg border border-slate-200 overflow-hidden flex flex-col">
          {/* 这层同时管横向和纵向滚动，高度被外层 flex-1 卡住不超过可视区域——两个滚动条
              都贴在这个可视区域的边上，不会因为行数多就要先滚到最底下才看得到横向滚动条。
              表头加 sticky，往下滚的时候列名还在，不用来回滚回顶部确认自己在看哪一列。
              这一层也是虚拟化的滚动容器：ref + onScroll 驱动"只渲染视口内的行"。 */}
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                {viewMode === 'active' && (
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-slate-300 text-slate-800 focus:ring-slate-500 cursor-pointer"
                    />
                  </th>
                )}
                {visibleColumns.map((col) => {
                  const sortIdx = sortStack.findIndex((s) => s.key === col.key);
                  const active = sortIdx !== -1;
                  const dir = active ? sortStack[sortIdx].dir : null;
                  return (
                    <th
                      key={col.key}
                      onClick={(e) => handleSort(col.key, e.shiftKey)}
                      className="px-4 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:bg-slate-100"
                    >
                      <div className="flex items-center gap-1">
                        <span>{col.label}</span>
                        {active && (dir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                        {sortStack.length > 1 && active && (
                          <span className="text-xs font-normal text-slate-400">{sortIdx + 1}</span>
                        )}
                      </div>
                    </th>
                  );
                })}
                {viewMode === 'history' && (
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider whitespace-nowrap">
                    Completed
                  </th>
                )}
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={visibleColumns.length + extraColumnCount} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                      <span className="text-sm text-slate-500">Loading containers...</span>
                    </div>
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length + extraColumnCount} className="px-6 py-16 text-center text-sm text-slate-500">
                    {searchTerm
                      ? 'No containers match your search.'
                      : viewMode === 'active'
                        ? 'No containers yet — click Add Containers to start tracking.'
                        : "Nothing here yet — containers you mark complete will show up here."}
                  </td>
                </tr>
              ) : (
                <>
                  {/* 上方 spacer：把还没渲染的前面那些行的高度占住，滚动条位置才对。 */}
                  {topPad > 0 && (
                    <tr aria-hidden style={{ height: topPad }}>
                      <td colSpan={totalColumnCount} className="p-0 border-0" />
                    </tr>
                  )}
                  {visibleRecords.map((record) => (
                    <TrackingRow
                      key={record.id}
                      record={record}
                      visibleColumns={visibleColumns}
                      viewMode={viewMode}
                      isSelected={selectedIds.has(record.id)}
                      completing={completingId === record.id}
                      deleting={deletingId === record.id}
                      confirmingDelete={confirmDeleteId === record.id}
                      reopening={reopeningId === record.id}
                      onSetShiftHeld={setShiftHeld}
                      onCheckboxToggle={handleCheckboxToggle}
                      onComplete={handleCompleteClick}
                      onDelete={handleDeleteClick}
                      onReopen={handleReopenClick}
                    />
                  ))}
                  {/* 下方 spacer：占住后面还没渲染的行的高度。 */}
                  {bottomPad > 0 && (
                    <tr aria-hidden style={{ height: bottomPad }}>
                      <td colSpan={totalColumnCount} className="p-0 border-0" />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      <AddContainersModal open={addOpen} onClose={() => setAddOpen(false)} onSubmit={onAddContainers} />
      <ColumnSettingsModal open={columnSettingsOpen} columns={columns} onClose={() => setColumnSettingsOpen(false)} onSave={onSaveColumns} />
    </div>
  );
}
