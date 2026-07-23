import type { ReactNode } from 'react';

/**
 * Small centered confirmation modal. Renders above other overlays (z-index 20 vs the
 * wizard's 10). Backdrop click and the cancel button both cancel; confirm is styled
 * danger by default since these gates guard destructive actions.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
      }}
      onClick={onCancel}
    >
      <div className="panel" style={{ width: 400, margin: 16 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {body != null && (
          <div className="small muted" style={{ marginBottom: 16 }}>
            {body}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={danger ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
