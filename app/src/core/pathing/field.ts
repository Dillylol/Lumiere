/**
 * The field as the Pedro Pathing Visualizer draws it.
 *
 * Adapted from the Pedro Pathing Visualizer's `src/config/defaults.ts` and `src/view/snap.ts`
 * (https://github.com/Pedro-Pathing/Visualizer), licensed under the Apache License 2.0.
 * Modified by The Lumière Contributors for Lumière's field editor.
 *
 * The floor inside the walls is 141.5 inches. The field picture covers six 24-inch tiles, so it runs
 * 1.25 inches under each wall, and grid lines are spaced from the tile seams.
 */
import type { Point } from "../ir/types";

export const FIELD_FLOOR_INCHES = 141.5;
export const TILE_INCHES = 24;
/** How far the field picture extends past the floor on every side. */
export const FIELD_IMAGE_OVERHANG = (6 * TILE_INCHES - FIELD_FLOOR_INCHES) / 2;
/** Grid spacings in inches, in the order the grid button steps through them. */
export const GRID_SIZES = [1, 3, 6, 12] as const;

export const clampToFloor = (value: number) => Math.max(0, Math.min(FIELD_FLOOR_INCHES, value));

/**
 * Keeps a point on the floor, snapping it to the nearest grid intersection when `grid` is set
 * (spaced from the tile corner, like the field's seams) and otherwise rounding to a tenth of an inch.
 */
export function snapToGrid(point: Point, grid: number): Point {
  const snap = (value: number) => grid > 0
    ? Math.round((value + FIELD_IMAGE_OVERHANG) / grid) * grid - FIELD_IMAGE_OVERHANG
    : Math.round(value * 10) / 10;
  return { x: clampToFloor(snap(point.x)), y: clampToFloor(snap(point.y)) };
}

/** Grid line positions across the floor for a spacing, aligned to the tile seams. */
export function gridLines(grid: number): number[] {
  const lines: number[] = [];
  for (let at = -FIELD_IMAGE_OVERHANG; at <= FIELD_FLOOR_INCHES + 1e-9; at += grid) if (at >= 0) lines.push(Math.round(at * 1000) / 1000);
  return lines;
}
