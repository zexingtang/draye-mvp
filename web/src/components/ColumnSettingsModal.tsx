import { useEffect, useState } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Eye, EyeOff, GripVertical, Loader2, X } from 'lucide-react';
import type { ColumnDef } from '../types/tracking';

interface ColumnSettingsModalProps {
  open: boolean;
  columns: ColumnDef[];
  onClose: () => void;
  onSave: (columns: ColumnDef[]) => Promise<void>;
}

function Row({
  col,
  index,
  moveRow,
  onToggleVisible,
}: {
  col: ColumnDef;
  index: number;
  moveRow: (from: number, to: number) => void;
  onToggleVisible: (key: string) => void;
}) {
  const [{ isDragging }, drag] = useDrag({
    type: 'COLUMN_SETTING',
    item: { index },
    collect: (m) => ({ isDragging: m.isDragging() }),
  });
  const [, drop] = useDrop({
    accept: 'COLUMN_SETTING',
    hover: (item: { index: number }) => {
      if (item.index !== index) {
        moveRow(item.index, index);
        item.index = index;
      }
    },
  });

  return (
    <div
      ref={(node) => drag(drop(node))}
      className={`flex items-center gap-3 px-3 py-2.5 border rounded-lg ${
        isDragging ? 'opacity-50 border-slate-300 bg-slate-50' : 'border-slate-200 bg-white'
      }`}
    >
      <GripVertical className="w-4 h-4 text-slate-400 cursor-move flex-shrink-0" />
      <span className="flex-1 text-sm text-slate-900">{col.label}</span>
      <button
        onClick={() => onToggleVisible(col.key)}
        title={col.visible ? 'Visible in table (click to hide)' : 'Hidden (click to show)'}
        className="p-1.5 rounded hover:bg-slate-100 text-slate-500 flex-shrink-0"
      >
        {col.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
      </button>
    </div>
  );
}

export function ColumnSettingsModal({ open, columns, onClose, onSave }: ColumnSettingsModalProps) {
  const [local, setLocal] = useState<ColumnDef[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLocal([...columns].sort((a, b) => a.order - b.order));
      setSaveError(null);
    }
  }, [open, columns]);

  if (!open) return null;

  const moveRow = (from: number, to: number) => {
    setLocal((prev) => {
      const next = [...prev];
      const [removed] = next.splice(from, 1);
      next.splice(to, 0, removed);
      return next;
    });
  };

  const toggleVisible = (key: string) => {
    setLocal((prev) => prev.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const withOrder = local.map((c, i) => ({ ...c, order: i }));
      await onSave(withOrder);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Columns</h2>
            <p className="text-xs text-slate-500 mt-0.5">Drag to reorder. Choose which fields show in the table.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {saveError && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>}

          <DndProvider backend={HTML5Backend}>
            <div className="space-y-2">
              {local.map((col, i) => (
                <Row key={col.key} col={col} index={i} moveRow={moveRow} onToggleVisible={toggleVisible} />
              ))}
            </div>
          </DndProvider>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-900 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
