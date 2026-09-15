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

import { brandConfig, resolveProductLogo, resolveProductName } from './brand'

describe('product brand resolution', () => {
  test('does not render upstream defaults as the ordinary product brand', () => {
    assert.equal(resolveProductName('New API'), brandConfig.name)
    assert.equal(resolveProductName(' NewAPI '), brandConfig.name)
    assert.equal(resolveProductLogo('/logo.png'), brandConfig.logo)
  })

  test('retains an explicit administrator override', () => {
    assert.equal(resolveProductName('Team Gateway'), 'Team Gateway')
    assert.equal(resolveProductLogo('/team.svg'), '/team.svg')
  })
})
