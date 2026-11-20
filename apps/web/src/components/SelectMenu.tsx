import { useTranslation } from '../i18n.ts';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  /** 右侧的浅色说明，比如「当前」「远端」 */
  hint?: string;
}

interface SelectMenuProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** 没选中时显示的文案 */
  placeholder: string;
  disabled?: boolean;
  /** 弹层需要往右对齐时用 */
  align?: 'left' | 'right';
  ariaLabel?: string;
  className?: string;
}

/**
 * 自定义下拉：原生 <select> 的弹层由系统绘制，主题色管不到，
 * 深色下会出现白底浅字。这里自己画，颜色全部走 CSS 变量。
 */
export function SelectMenu({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  align = 'left',
  ariaLabel,
  className = '',
}: SelectMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    // 打开时把当前项滚进视野
    requestAnimationFrame(() => {
      listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    });
  }, [open, selectedIndex]);

  const commit = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit(active);
    }
  };

  return (
    <div className={`sel ${className}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className={`sel-trigger ${open ? 'is-open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel ?? placeholder}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`sel-value ${selected ? '' : 'is-placeholder'}`}>
          {selected ? selected.label : placeholder}
          {selected?.hint ? <em className="sel-hint">{selected.hint}</em> : null}
        </span>
        <span className="sel-caret" aria-hidden="true" />
      </button>

      {open ? (
        <div className={`sel-pop ${align === 'right' ? 'is-right' : ''}`} role="listbox" id={listId} ref={listRef}>
          {options.length === 0 ? <div className="sel-empty">{t("没有可选项")}</div> : null}
          {options.map((option, index) => (
            <button
              key={option.value || `empty-${index}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`sel-option ${index === active ? 'is-active' : ''} ${
                option.value === value ? 'is-selected' : ''
              }`}
              onMouseEnter={() => setActive(index)}
              onClick={() => commit(index)}
            >
              <span className="sel-option-label">{option.label}</span>
              {option.hint ? <em className="sel-hint">{option.hint}</em> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
