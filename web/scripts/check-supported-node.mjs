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
import { fileURLToPath } from 'node:url'

export function isSupportedNodeVersion(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number)
  if (major === 20) return minor >= 19
  if (major === 21) return false
  if (major === 22) return minor >= 12
  return major > 22
}

export function assertSupportedNodeVersion(version = process.version) {
  if (isSupportedNodeVersion(version)) return
  throw new Error(
    `Unsupported Node.js ${version}. Use Node.js 20.19+ or 22.12+ before running the frontend.`
  )
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  assertSupportedNodeVersion()
  process.stdout.write(`Node.js ${process.version} is supported.\n`)
}
