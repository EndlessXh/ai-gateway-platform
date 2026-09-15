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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { splitIntoColumns } from '../columns'

describe('rankings two-column split', () => {
  test('gives the left column the extra row when the count is odd', () => {
    const [left, right] = splitIntoColumns([1, 2, 3, 4, 5])
    assert.deepEqual(left, [1, 2, 3])
    assert.deepEqual(right, [4, 5])
  })

  test('splits evenly when the count is even', () => {
    const [left, right] = splitIntoColumns([1, 2, 3, 4])
    assert.deepEqual(left, [1, 2])
    assert.deepEqual(right, [3, 4])
  })

  test('puts a single item in the left column and leaves the right empty', () => {
    const [left, right] = splitIntoColumns([1])
    assert.deepEqual(left, [1])
    assert.deepEqual(right, [])
  })

  test('returns two empty columns for an empty list', () => {
    const [left, right] = splitIntoColumns([])
    assert.deepEqual(left, [])
    assert.deepEqual(right, [])
  })

  test('preserves row order within each column', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const [left, right] = splitIntoColumns(rows)
    assert.deepEqual(left, ['a', 'b', 'c', 'd'])
    assert.deepEqual(right, ['e', 'f', 'g'])
  })
})
