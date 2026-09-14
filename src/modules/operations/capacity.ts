/**
 * The one invariant Operations keeps repeating: a finite number of places,
 * and a set of people or things occupying them. Hostel rooms have beds,
 * vehicles have seats, library titles have copies, a store has stock.
 *
 * All four fail the same way — two people allocate the last place at the
 * same moment, and the count goes over or negative. This module holds the
 * arithmetic and the decision; the services hold the conditional write that
 * makes it safe under concurrency (see `library.service.ts` for the pattern:
 * decrement with a `WHERE availableCopies > 0` guard and treat "0 rows
 * updated" as the race having been lost, rather than reading-then-writing).
 */

export interface Occupancy {
  capacity: number;
  occupied: number;
}

export function placesFree(o: Occupancy): number {
  return Math.max(0, o.capacity - o.occupied);
}

export function isFull(o: Occupancy): boolean {
  return o.occupied >= o.capacity;
}

/** 0–100, clamped. A capacity of 0 reads as full, not as a division by zero. */
export function occupancyPercent(o: Occupancy): number {
  if (o.capacity <= 0) return 100;
  return Math.min(100, Math.round((o.occupied / o.capacity) * 100));
}

export type CapacityCheck = { ok: true } | { ok: false; message: string };

export function checkAdmits(o: Occupancy, label: string, count = 1): CapacityCheck {
  if (o.capacity <= 0) return { ok: false, message: `${label} has no capacity set` };
  if (o.occupied + count > o.capacity) {
    const free = placesFree(o);
    return { ok: false, message: `${label} is full — ${o.occupied} of ${o.capacity} taken, ${free} place${free === 1 ? "" : "s"} free` };
  }
  return { ok: true };
}

/** Tone for a capacity bar: comfortable, filling up, or full. */
export function occupancyTone(o: Occupancy): "green" | "amber" | "red" {
  if (isFull(o)) return "red";
  return occupancyPercent(o) >= 80 ? "amber" : "green";
}
