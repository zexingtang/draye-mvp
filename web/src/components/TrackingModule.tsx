import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Columns3,
  Loader2,
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
import type { AddContainersResult } from '../hooks/useTrackingRecords';
import { AddContainersModal } from './AddContainersModal';
import { ColumnSettingsModal } from './ColumnSettingsModal';

interface TrackingModuleProps {
  records: TrackingRecord[];
  historyRecords: TrackingRecord[];
  columns: ColumnDef[];
  loading: boolean;
  tracking: boolean;
  error: string | null;
  onTriggerTrackAll: () => Promise<void>;
  onAddContainers: (containerNumbers: string[], carrier: string) => Promise<AddContainersResult>;
  onDeleteContainer: (containerNumber: string) => Promise<void>;
  onCompleteContainer: (containerNumber: string) => Promise<void>;
  onReopenContainer: (containerNumber: string) => Promise<void>;
  onBatchDeleteContainers: (containerNumbers: string[]) => Promise<number>;
  onBatchCompleteContainers: (containerNumbers: string[]) => Promise<number>;
  onSaveColumns: (columns: ColumnDef[]) => Promise<void>;
  scheduleHours: number | null;
  scheduleEnabled: boolean;
  scheduleUpdating: boolean;
  onSetSchedule: (hours: number) => Promise<void>;
  onStopSchedule: () => Promise<void>;
}

type ViewMode = 'active' | 'history';

const SCHEDULE_OPTIONS = [1, 2, 4, 8];

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

export function TrackingModule({
  records,
  historyRecords,
  columns,
  loading,
  tracking,
  error,
  onTriggerTrackAll,
  onAddContainers,
  onDeleteContainer,
  onCompleteContainer,
  onReopenContainer,
  onBatchDeleteContainers,
  onBatchCompleteContainers,
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
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showScheduleMenu, setShowScheduleMenu] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchActing, setBatchActing] = useState(false);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const confirmResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const batchConfirmResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 切到 History,或者列表刷新之后已选的箱号被删/完成了,已选状态就没意义了,清空。
  useEffect(() => {
    setSelectedIds(new Set());
    setConfirmBatchDelete(false);
  }, [viewMode]);

  /** 不用嵌套的 setState 写法（在 setSortBy 的 updater 里调 setSortDir）——React 为了检测
   * "返回值有没有变"会把 updater 多调一次，副作用里的 setSortDir 也跟着多触发一次，
   * 一来一回等于没切换，点第二下没反应。改成直接读当前值判断，不用 useCallback 包（这个
   * handler 只在本文件内联调用，不需要跨渲染保持引用稳定）。 */
  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  /** 点一下变成"确认删除"态（3 秒内没再点会自动取消），再点一下才真的删——不用原生 confirm()。 */
  const handleDeleteClick = useCallback(
    async (record: TrackingRecord) => {
      if (confirmDeleteId !== record.id) {
        if (confirmResetRef.current) clearTimeout(confirmResetRef.current);
        setConfirmDeleteId(record.id);
        confirmResetRef.current = setTimeout(() => setConfirmDeleteId(null), 3000);
        return;
      }
      if (confirmResetRef.current) clearTimeout(confirmResetRef.current);
      setConfirmDeleteId(null);
      setDeletingId(record.id);
      try {
        await onDeleteContainer(record.containerNumber);
      } finally {
        setDeletingId(null);
      }
    },
    [confirmDeleteId, onDeleteContainer]
  );

  /** Complete 单击即完成，不需要二次确认——它很容易撤销(History 里 Reopen)，不像 Delete 那样是真的丢数据。 */
  const handleCompleteClick = useCallback(
    async (record: TrackingRecord) => {
      setCompletingId(record.id);
      try {
        await onCompleteContainer(record.containerNumber);
      } finally {
        setCompletingId(null);
      }
    },
    [onCompleteContainer]
  );

  /** Reopen 跟 Complete 一样不需要确认——本来就是"撤销"操作，不会丢数据。 */
  const handleReopenClick = useCallback(
    async (record: TrackingRecord) => {
      setReopeningId(record.id);
      try {
        await onReopenContainer(record.containerNumber);
      } finally {
        setReopeningId(null);
      }
    },
    [onReopenContainer]
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Batch complete 跟单条一样不需要确认——容易撤销(History 里逐条 Reopen)。 */
  const handleBatchComplete = useCallback(async () => {
    const containerNumbers = records.filter((r) => selectedIds.has(r.id)).map((r) => r.containerNumber);
    if (containerNumbers.length === 0) return;
    setBatchActing(true);
    try {
      await onBatchCompleteContainers(containerNumbers);
      setSelectedIds(new Set());
    } finally {
      setBatchActing(false);
    }
  }, [records, selectedIds, onBatchCompleteContainers]);

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
    const containerNumbers = records.filter((r) => selectedIds.has(r.id)).map((r) => r.containerNumber);
    if (containerNumbers.length === 0) return;
    setBatchActing(true);
    try {
      await onBatchDeleteContainers(containerNumbers);
      setSelectedIds(new Set());
    } finally {
      setBatchActing(false);
    }
  }, [confirmBatchDelete, records, selectedIds, onBatchDeleteContainers]);

  const visibleColumns = [...columns].filter((c) => c.visible).sort((a, b) => a.order - b.order);
  const sourceRecords = viewMode === 'active' ? records : historyRecords;

  const filtered = sourceRecords.filter((r) => r.containerNumber.toLowerCase().includes(searchTerm.toLowerCase()));

  const sorted = sortBy
    ? [...filtered].sort((a, b) => {
        // 空值永远排最后，不管升序降序——不然点"按 ETA 排序"结果一堆没有 ETA 的空箱号
        // 排在最前面，最该关注的"快到期的箱子"反而要往下翻才看得到。
        if (sortBy === 'lastUpdated') {
          if (!a.lastUpdated && !b.lastUpdated) return 0;
          if (!a.lastUpdated) return 1;
          if (!b.lastUpdated) return -1;
          const at = new Date(a.lastUpdated).getTime();
          const bt = new Date(b.lastUpdated).getTime();
          return sortDir === 'asc' ? at - bt : bt - at;
        }
        const av = getFieldValue(a, sortBy);
        const bv = getFieldValue(b, sortBy);
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        const cmp = av.localeCompare(bv);
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : viewMode === 'history'
      ? [...filtered].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
      : filtered;

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

                <button
                  onClick={onTriggerTrackAll}
                  disabled={tracking}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  {tracking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Track All
                </button>

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
                        {SCHEDULE_OPTIONS.map((h) => (
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
                        ))}
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
              表头加 sticky，往下滚的时候列名还在，不用来回滚回顶部确认自己在看哪一列。 */}
          <div className="flex-1 min-h-0 overflow-auto">
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
                  const active = sortBy === col.key;
                  return (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="px-4 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:bg-slate-100"
                    >
                      <div className="flex items-center gap-1">
                        <span>{col.label}</span>
                        {active && (sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
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
                sorted.map((record) => (
                  <tr key={record.id} className={`hover:bg-slate-50 transition-colors ${selectedIds.has(record.id) ? 'bg-slate-50' : ''}`}>
                    {viewMode === 'active' && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(record.id)}
                          onChange={() => toggleSelect(record.id)}
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
                            onClick={() => handleCompleteClick(record)}
                            disabled={completingId === record.id}
                            title={`Mark ${record.containerNumber} complete`}
                            className="p-1.5 rounded hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors disabled:opacity-50"
                          >
                            {completingId === record.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4" />
                            )}
                          </button>
                          {confirmDeleteId === record.id ? (
                            <button
                              onClick={() => handleDeleteClick(record)}
                              disabled={deletingId === record.id}
                              className="px-2 py-1 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-1"
                            >
                              {deletingId === record.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                              Confirm?
                            </button>
                          ) : (
                            <button
                              onClick={() => handleDeleteClick(record)}
                              title={`Remove ${record.containerNumber}`}
                              className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => handleReopenClick(record)}
                          disabled={reopeningId === record.id}
                          title={`Reopen ${record.containerNumber}`}
                          className="p-1.5 rounded hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors disabled:opacity-50 ml-auto block"
                        >
                          {reopeningId === record.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RotateCcw className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
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
