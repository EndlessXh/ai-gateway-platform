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

const firstPhase4Key = STATIC_I18N_KEYS.indexOf('{{name}} logo')
const lastPhase4Key = STATIC_I18N_KEYS.indexOf(
  'Retry the page. If the problem continues, return home or consult the documentation.'
)

assert.notEqual(firstPhase4Key, -1)
assert.notEqual(lastPhase4Key, -1)

const PHASE4_KEYS = [
  'Pricing',
  'About',
  'Documentation',
  'Support',
  'Legal notice',
  ...STATIC_I18N_KEYS.slice(firstPhase4Key, lastPhase4Key + 1),
]
const enTranslation = en.translation as Record<string, string>
const zhTranslation = zhCN.translation as Record<string, string>

function interpolationTokens(value: string): string[] {
  return [...value.matchAll(/{{\s*([\w.-]+)\s*}}/g)]
    .map((match) => match[1])
    .sort()
}

describe('Phase 4 internationalization guard', () => {
  test('every scoped key exists in en and zhCN', () => {
    for (const key of PHASE4_KEYS) {
      assert.equal(typeof enTranslation[key], 'string', `missing en: ${key}`)
      assert.equal(typeof zhTranslation[key], 'string', `missing zhCN: ${key}`)
    }
  })

  test('zhCN does not silently fall back to the Phase 4 English copy', () => {
    for (const key of PHASE4_KEYS) {
      assert.notEqual(
        zhTranslation[key],
        enTranslation[key],
        `untranslated zhCN value: ${key}`
      )
    }
  })

  test('en and zhCN preserve the same interpolation variables', () => {
    for (const key of PHASE4_KEYS) {
      assert.deepEqual(
        interpolationTokens(zhTranslation[key]),
        interpolationTokens(enTranslation[key]),
        `interpolation mismatch: ${key}`
      )
    }
  })
})
