import type { ExerciseType, WorkoutSet } from '../types/models';

/**
 * Estimated one-rep max (Epley): weight × (1 + reps / 30).
 * Only computed when the data is suitable: a real load and 1–12 reps
 * (the formula gets unreliable for high-rep sets).
 */
export function epley1RM(weightKg: number | null, reps: number | null): number | null {
  if (weightKg == null || reps == null || weightKg <= 0 || reps < 1 || reps > 12) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export function usesWeight(t: ExerciseType) {
  return t === 'weight' || t === 'weighted_bodyweight';
}
export function usesReps(t: ExerciseType) {
  return t === 'weight' || t === 'weighted_bodyweight' || t === 'bodyweight';
}
export function supportsE1RM(t: ExerciseType) {
  return t === 'weight';
}

export interface SetStats {
  topSet: WorkoutSet | null; // heaviest; ties broken by reps
  maxWeight: number | null;
  maxReps: number | null;
  bestE1RM: number | null;
  volume: number; // kg × reps (weight types) or total reps (bodyweight)
  totalReps: number;
  completedSets: number;
  totalSeconds: number;
  totalDistance: number;
}

export function setStats(sets: WorkoutSet[], type: ExerciseType): SetStats {
  const done = sets.filter((s) => s.completed);
  let topSet: WorkoutSet | null = null;
  let maxWeight: number | null = null;
  let maxReps: number | null = null;
  let bestE1RM: number | null = null;
  let volume = 0;
  let totalReps = 0;
  let totalSeconds = 0;
  let totalDistance = 0;
  for (const s of done) {
    if (s.weight_kg != null) {
      if (maxWeight == null || s.weight_kg > maxWeight) maxWeight = s.weight_kg;
      if (
        !topSet ||
        (topSet.weight_kg ?? -1) < s.weight_kg ||
        ((topSet.weight_kg ?? -1) === s.weight_kg && (topSet.reps ?? 0) < (s.reps ?? 0))
      )
        topSet = s;
    } else if (!usesWeight(type) && s.reps != null && (!topSet || (topSet.reps ?? 0) < s.reps)) {
      topSet = s;
    }
    if (s.reps != null) {
      totalReps += s.reps;
      if (maxReps == null || s.reps > maxReps) maxReps = s.reps;
    }
    if (supportsE1RM(type)) {
      const e = epley1RM(s.weight_kg, s.reps);
      if (e != null && (bestE1RM == null || e > bestE1RM)) bestE1RM = e;
    }
    if (usesWeight(type) && s.weight_kg != null && s.reps != null) volume += s.weight_kg * s.reps;
    if (s.duration_seconds != null) totalSeconds += s.duration_seconds;
    if (s.distance_m != null) totalDistance += s.distance_m;
  }
  if (type === 'bodyweight') volume = totalReps;
  return { topSet, maxWeight, maxReps, bestE1RM, volume, totalReps, completedSets: done.length, totalSeconds, totalDistance };
}
