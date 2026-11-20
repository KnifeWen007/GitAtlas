import { useTranslation } from '../i18n.ts';
import { useEffect, useRef } from 'react';

export interface ConfirmRequest {
  title: string;
  body: string;
  /** 确认按钮上的字，默认「确定」 */
  confirmLabel?: string;
  /** 会造成数据损失的操作用红色，并把焦点放在「取消」上 */
  danger?: boolean;
  onConfirm: () => void;
}

interface ConfirmDialogProps {
  request: ConfirmRequest | null;
  onCancel: () => void;
}

/**
 * 应用内确认框，替掉 window.confirm。
 *
 * 原生 confirm 的按钮顺序、文案和配色都由系统决定，和这套界面完全不搭；
 * 更重要的是危险操作要能把"影响什么"说清楚，窗口那一行小字做不到。
 */
export function ConfirmDialog({ request, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    // 危险操作默认聚焦取消，避免顺手一个回车就把东西删了
    const target = request.danger ? cancelRef.current : confirmRef.current;
    target?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, onCancel]);

  if (!request) return null;

  return (
    <div
      className="overlay overlay-top"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className={`dialog dialog-confirm${request.danger ? ' is-danger' : ''}`} role="alertdialog" aria-modal="true" aria-label={request.title}>
        <div className="dialog-head">{request.title}</div>
        <div className="dialog-body">
          <p className="confirm-body">{request.body}</p>
        </div>
        <div className="dialog-foot">
          <button ref={cancelRef} className="btn btn-ghost" onClick={onCancel}>
            {t("取消")}
          </button>
          <button
            ref={confirmRef}
            className={`btn ${request.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              request.onConfirm();
              onCancel();
            }}
          >
            {request.confirmLabel ?? t("确定")}
          </button>
        </div>
      </div>
    </div>
  );
}
