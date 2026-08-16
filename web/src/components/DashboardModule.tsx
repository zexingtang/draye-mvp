import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Package } from 'lucide-react';
import { WelcomeBanner } from './WelcomeBanner';
import type { TrackingRecord } from '../types/tracking';

interface DashboardModuleProps {
  records: TrackingRecord[];
  loading: boolean;
  companyName: string;
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

export function DashboardModule({ records, loading, companyName }: DashboardModuleProps) {
  const metrics = useMemo(() => {
    const total = records.length;
    const active = records.filter((r) => r.status === 'ACTIVE').length;
    const unknown = records.filter((r) => r.status === 'UNKNOWN' || r.status === 'ERROR').length;
    const atRisk = records.filter((r) => isToday(r.lastFreeDay)).length;
    return { total, active, unknown, atRisk };
  }, [records]);

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const cards = [
    { id: 'total', label: 'Total Containers', value: metrics.total, icon: Package, color: 'blue' },
    { id: 'active', label: 'Active (has ETA)', value: metrics.active, icon: CheckCircle2, color: 'emerald' },
    { id: 'atRisk', label: 'LFD Today', value: metrics.atRisk, icon: AlertTriangle, color: 'red' },
    { id: 'unknown', label: 'Not Found / Unknown', value: metrics.unknown, icon: HelpCircle, color: 'amber' },
  ] as const;

  const colorClasses: Record<string, { bg: string; text: string }> = {
    blue: { bg: 'bg-blue-100', text: 'text-blue-600' },
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600' },
    red: { bg: 'bg-red-100', text: 'text-red-600' },
    amber: { bg: 'bg-amber-100', text: 'text-amber-600' },
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <WelcomeBanner companyName={companyName} />
      </div>

      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Tracking</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          const cc = colorClasses[c.color];
          return (
            <div key={c.id} className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow border border-slate-200">
              <div className="flex items-start justify-between mb-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{c.label}</p>
                <div className={`p-2.5 rounded-lg ${cc.bg}`}>
                  <Icon className={`w-5 h-5 ${cc.text}`} />
                </div>
              </div>
              <p className="text-4xl font-bold text-slate-900">{c.value}</p>
              {c.id === 'atRisk' && c.value > 0 && (
                <p className="text-xs text-red-600 font-medium mt-2">Needs immediate attention</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
