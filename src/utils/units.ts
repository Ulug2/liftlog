import type { WeightUnit } from '../types/models';

export const KG_PER_LB = 0.45359237;

/** kg (storage) → number in the display unit, rounded to 2 decimals */
export function toDisplay(kg: number | null | undefined, unit: WeightUnit): number | null {
  if (kg == null) return null;
  const v = unit === 'kg' ? kg : kg / KG_PER_LB;
  return Math.round(v * 100) / 100;
}

/** number typed in the display unit → kg for storage */
export function fromDisplay(value: number | null, unit: WeightUnit): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return unit === 'kg' ? value : value * KG_PER_LB;
}

export function fmtNum(n: number | null | undefined, maxDecimals = 1): string {
  if (n == null) return '–';
  const f = Math.pow(10, maxDecimals);
  const r = Math.round(n * f) / f;
  return r.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

export function fmtWeight(kg: number | null | undefined, unit: WeightUnit, withUnit = true): string {
  const v = toDisplay(kg, unit);
  if (v == null) return '–';
  return withUnit ? `${fmtNum(v, 2)} ${unit}` : fmtNum(v, 2);
}

/** Compact volume, e.g. 12,450 lb or 18.2k */
export function fmtVolume(kg: number, unit: WeightUnit): string {
  const v = toDisplay(kg, unit) ?? 0;
  if (v >= 100000) return `${fmtNum(v / 1000, 0)}k ${unit}`;
  if (v >= 10000) return `${fmtNum(v / 1000, 1)}k ${unit}`;
  return `${fmtNum(v, 0)} ${unit}`;
}

export function weightStep(unit: WeightUnit) {
  return unit === 'kg' ? 2.5 : 5;
}

/** Parse what the user typed. Empty → null (unknown), never 0. */
export function parseNum(s: string): number | null {
  const t = s.replace(',', '.').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
