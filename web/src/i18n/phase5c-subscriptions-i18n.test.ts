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

import en from './locales/en.json'
import zhCN from './locales/zh.json'
import { STATIC_I18N_KEYS } from './static-keys'

const firstKey = STATIC_I18N_KEYS.indexOf('Account default')
const lastKey = STATIC_I18N_KEYS.indexOf('Wallet overflow')
const keys = STATIC_I18N_KEYS.slice(firstKey, lastKey + 1)
const enTranslation = en.translation as Record<string, string>
const zhTranslation = zhCN.translation as Record<string, string>

describe('Phase 5C subscription internationalization guard', () => {
  test('all scoped copy exists in en and zhCN', () => {
    assert.notEqual(firstKey, -1)
    assert.notEqual(lastKey, -1)
    for (const key of keys) {
      assert.equal(typeof enTranslation[key], 'string', `missing en: ${key}`)
      assert.equal(typeof zhTranslation[key], 'string', `missing zhCN: ${key}`)
    }
  })

  test('zhCN does not silently fall back to English', () => {
    for (const key of keys) {
      assert.notEqual(zhTranslation[key], enTranslation[key], key)
    }
  })
})
