import { useEffect, useRef, useState } from 'react';
import { parseNum } from '../utils/units';

/**
 * Numeric input tuned for iPhone: numeric keypad, select-all on focus so a new
 * value can be typed immediately, and every keystroke is saved (no "unsaved"
 * state if the phone locks mid-edit). Empty means "unknown" (null), never 0.
 */
export function NumberField({
  value,
  onChange,
  decimal = false,
  placeholder,
  className = '',
  label,
  onFocus,
  id,
}: {
  id?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  decimal?: boolean;
  placeholder?: string;
  className?: string;
  label: string;
  onFocus?: () => void;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : String(value));
  }, [value]);

  return (
    <input
      id={id}
      className={className}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      pattern={decimal ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
      enterKeyHint="done"
      autoComplete="off"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        const el = e.currentTarget;
        // iOS needs the selection to happen after focus settles
        setTimeout(() => el.select(), 0);
        onFocus?.();
      }}
      onBlur={() => {
        focused.current = false;
        setText(value == null ? '' : String(value));
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.,]/g, '');
        const clean = decimal ? raw : raw.replace(/[.,]/g, '');
        setText(clean);
        const n = parseNum(clean);
        if (clean === '' || n != null) onChange(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}
