import { useMemo, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { SUPPORTED_CARRIERS } from '../types/tracking';
import type { AddContainersResult } from '../hooks/useTrackingRecords';

interface AddContainersModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (containerNumbers: string[], carrier: string) => Promise<AddContainersResult>;
}

/** 支持空格、逗号、换行任意混用分隔 */
function parseContainerNumbers(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function AddContainersModal({ open, onClose, onSubmit }: AddContainersModalProps) {
  const [text, setText] = useState('');
  const [carrier, setCarrier] = useState<string>(SUPPORTED_CARRIERS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AddContainersResult | null>(null);

  const parsed = useMemo(() => parseContainerNumbers(text), [text]);
  const uniqueCount = useMemo(() => new Set(parsed).size, [parsed]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (parsed.length === 0) return;
    setSubmitting(true);
    try {
      const res = await onSubmit(parsed, carrier);
      setResult(res);
      setText('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setText('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add Containers</h2>
          <button onClick={handleClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6">
          {result ? (
            <div className="text-sm">
              <p className="text-slate-900 font-medium mb-2">
                Added {result.added} container{result.added === 1 ? '' : 's'}.
              </p>
              {result.reactivated > 0 && (
                <p className="text-slate-600 mb-2">
                  Reopened {result.reactivated} previously-completed container{result.reactivated === 1 ? '' : 's'} back into active tracking.
                </p>
              )}
              {result.duplicates.length > 0 && (
                <p className="text-slate-500">
                  Skipped {result.duplicates.length} already-tracked: {result.duplicates.join(', ')}
                </p>
              )}
              <button
                onClick={handleClose}
                className="mt-4 w-full px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-900 transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <label className="block text-xs font-medium text-slate-600 mb-2 uppercase">Rail</label>
              <select
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                className="w-full px-3 py-2 mb-4 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                {SUPPORTED_CARRIERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <p className="text-sm text-slate-600 mb-3">
                Paste container numbers below — spaces, commas, or new lines all work.
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder={'APZU4427577\nCAIU9123219\nCMAU4267371, CMAU7569020'}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
              <div className="mt-2 text-xs text-slate-500">
                {uniqueCount > 0 ? `${uniqueCount} container${uniqueCount === 1 ? '' : 's'} detected` : 'No containers detected yet'}
              </div>

              <div className="mt-4 flex gap-3">
                <button
                  onClick={handleClose}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={uniqueCount === 0 || submitting}
                  className="flex-1 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-900 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add {uniqueCount > 0 ? uniqueCount : ''}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
