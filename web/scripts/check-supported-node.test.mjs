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

import { isSupportedNodeVersion } from './check-supported-node.mjs'

describe('supported Node.js versions', () => {
  test('enforces the Rsbuild minimums used by this repository', () => {
    assert.equal(isSupportedNodeVersion('v20.18.0'), false)
    assert.equal(isSupportedNodeVersion('v20.19.0'), true)
    assert.equal(isSupportedNodeVersion('v21.7.3'), false)
    assert.equal(isSupportedNodeVersion('v22.11.0'), false)
    assert.equal(isSupportedNodeVersion('v22.12.0'), true)
    assert.equal(isSupportedNodeVersion('v24.0.0'), true)
  })
})
