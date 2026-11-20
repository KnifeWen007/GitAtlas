import { translateMessage, useTranslation } from '../i18n.ts';
export interface ToastItem {
  id: number;
  text: string;
  tone: 'ok' | 'err' | 'info';
}

interface ToastsProps {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}

/**
 * 右下角的轻提示：写操作的结果出现在视线附近，
 * 不用回头去操作台顶部找那一行字。
 */
export function Toasts({ items, onDismiss }: ToastsProps) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast ${item.tone}`}>
          <span className={`toast-dot ${item.tone}`} aria-hidden="true" />
          <span className="toast-text">{translateMessage(item.text)}</span>
          <button className="toast-close" onClick={() => onDismiss(item.id)} aria-label={t("关闭提示")}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
