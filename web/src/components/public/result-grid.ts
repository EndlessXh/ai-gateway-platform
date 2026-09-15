/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

/**
 * Column count for a card grid, chosen from the number of results actually
 * rendered.
 *
 * A fixed three-column grid is wrong for a catalogue that legitimately holds
 * very few rows: with the two models this deployment has, `lg:grid-cols-3`
 * left the third column empty — measured at 432px, 34% of the row, on the
 * pricing page at both 1440 and 1920.
 *
 * The capped widths are centred rather than left-aligned. That is the part
 * that actually fixes the "cards hug the left, right third is blank" look;
 * capping alone just moves the blank space.
 *
 * Never pads the grid with placeholder or transparent cards — a small
 * catalogue should look small, not fabricated.
 *
 * Class strings are written out in full so Tailwind's scanner can see them.
 */
export function resultGridClass(count: number): string {
  if (count <= 1) {
    return 'grid grid-cols-1 gap-5 mx-auto max-w-xl'
  }
  if (count === 2) {
    return 'grid grid-cols-1 gap-5 sm:grid-cols-2 mx-auto max-w-6xl'
  }
  return 'grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-3'
}
