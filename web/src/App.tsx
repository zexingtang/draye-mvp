import { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, LogOut, Ship } from 'lucide-react';
import { DashboardModule } from './components/DashboardModule';
import { TrackingModule } from './components/TrackingModule';
import { LoginPage } from './components/LoginPage';
import { useTrackingRecords } from './hooks/useTrackingRecords';
import { useColumns } from './hooks/useColumns';
import { useAuth } from './hooks/useAuth';
import { useSchedule } from './hooks/useSchedule';

type Tab = 'dashboard' | 'tracking';

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const { loading: authLoading, loggedIn, companyName, loginError, loggingIn, login, logout } = useAuth();
  const {
    records,
    loading,
    tracking,
    error,
    refetch: refetchTracking,
    triggerTrackAll,
    addContainers,
    deleteRecord,
    completeRecord,
    reopenRecord,
    batchDeleteRecords,
    batchCompleteRecords,
  } = useTrackingRecords();
  const { columns, saveColumns, refetch: refetchColumns } = useColumns();
  const {
    hours: scheduleHours,
    enabled: scheduleEnabled,
    updating: scheduleUpdating,
    refetch: refetchSchedule,
    setSchedule,
    stopSchedule,
  } = useSchedule();

  // 登录接口和 tracking/columns/schedule 接口是独立的 hook，登录成功之后需要主动重新拉一次数据——
  // 否则页面挂载时(还没登录)那次失败的请求(401)会一直留着当成"出错了"展示给用户。
  useEffect(() => {
    if (loggedIn) {
      refetchTracking();
      refetchColumns();
      refetchSchedule();
    }
  }, [loggedIn, refetchTracking, refetchColumns, refetchSchedule]);

  // Completed(已 dispatch)的箱号从 Tracking 的"Active"视图和 Dashboard 统计里排除，只在 History 里看得到。
  const activeRecords = useMemo(() => records.filter((r) => !r.completedAt), [records]);
  const completedRecords = useMemo(() => records.filter((r) => r.completedAt), [records]);

  const navItem = (id: Tab, label: string, Icon: typeof LayoutDashboard) => (
    <button
      onClick={() => setTab(id)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        tab === id ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!loggedIn) {
    return <LoginPage loginError={loginError} loggingIn={loggingIn} onLogin={login} />;
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="w-56 flex-shrink-0 bg-white border-r border-slate-200 p-4 flex flex-col gap-1">
        <div className="px-4 py-3 mb-2">
          <span className="text-lg font-bold text-slate-900 truncate block">{companyName}</span>
          <span className="text-xs text-slate-400">Powered by Drayease</span>
        </div>
        {navItem('dashboard', 'Dashboard', LayoutDashboard)}
        {navItem('tracking', 'Tracking', Ship)}

        <div className="mt-auto pt-2 border-t border-slate-200">
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        {tab === 'dashboard' && <DashboardModule records={activeRecords} loading={loading} companyName={companyName ?? 'there'} />}
        {tab === 'tracking' && (
          <TrackingModule
            records={activeRecords}
            historyRecords={completedRecords}
            columns={columns}
            loading={loading}
            tracking={tracking}
            error={error}
            onTriggerTrackAll={triggerTrackAll}
            onAddContainers={addContainers}
            onDeleteRecord={deleteRecord}
            onCompleteRecord={completeRecord}
            onReopenRecord={reopenRecord}
            onBatchDeleteRecords={batchDeleteRecords}
            onBatchCompleteRecords={batchCompleteRecords}
            onSaveColumns={saveColumns}
            scheduleHours={scheduleHours}
            scheduleEnabled={scheduleEnabled}
            scheduleUpdating={scheduleUpdating}
            onSetSchedule={setSchedule}
            onStopSchedule={stopSchedule}
          />
        )}
      </main>
    </div>
  );
}
