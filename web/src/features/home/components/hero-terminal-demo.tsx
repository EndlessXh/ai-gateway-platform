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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { brandConfig } from '@/config/brand'
import { cn } from '@/lib/utils'

/*
  Only the two request shapes this gateway actually relays are offered as tabs.
  Adding vendor tabs for providers that are not connected would imply support
  the platform does not have.

  The response blocks are illustrative request/response *shapes* — the same
  role a documentation snippet plays. Deliberately absent: latency, token
  counts and cost figures. Those would be measurements, and inventing them on
  a landing page misrepresents real performance.
*/
const EXAMPLES = [
  {
    id: 'chat',
    label: 'OpenAI-compatible',
    method: 'POST',
    endpoint: '/chat/completions',
    request: [
      '  "model": "platform-general-preview",',
      '  "stream": true,',
      '  "messages": [{ "role": "user", "content": "Hello" }]',
    ],
    response: [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: [DONE]',
    ],
    responseLabel: 'Streamed response',
  },
  {
    id: 'messages',
    label: 'Messages-compatible',
    method: 'POST',
    endpoint: '/messages',
    request: [
      '  "model": "platform-reasoning-preview",',
      '  "max_tokens": 1024,',
      '  "messages": [{ "role": "user", "content": "Explain this" }]',
    ],
    response: [
      '{',
      '  "content": [{ "type": "text", "text": "..." }],',
      '  "usage": { "input_tokens": 11, "output_tokens": 18 }',
      '}',
    ],
    responseLabel: 'Response',
  },
] as const

interface HeroTerminalDemoProps {
  className?: string
}

export function HeroTerminalDemo(props: HeroTerminalDemoProps) {
  const { t } = useTranslation()
  const [activeId, setActiveId] =
    useState<(typeof EXAMPLES)[number]['id']>('chat')
  const example = EXAMPLES.find((item) => item.id === activeId) ?? EXAMPLES[0]

  return (
    <div className={cn('surface-panel overflow-hidden', props.className)}>
      <div className='border-border flex items-center gap-1 border-b px-2 sm:px-3'>
        {EXAMPLES.map((item) => (
          <button
            key={item.id}
            type='button'
            onClick={() => setActiveId(item.id)}
            aria-pressed={activeId === item.id}
            className={cn(
              'relative min-h-11 px-3 text-[13px] font-medium transition-colors',
              activeId === item.id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(item.label)}
            {activeId === item.id ? (
              <span className='bg-primary absolute inset-x-2 -bottom-px h-0.5 rounded-full' />
            ) : null}
          </button>
        ))}
        <span className='ms-auto flex items-center gap-1.5 pe-2 text-xs'>
          <span className='bg-success size-1.5 rounded-full' />
          <span className='text-muted-foreground'>{t('SSE verified')}</span>
        </span>
      </div>

      <div className='px-4 pt-4 sm:px-5'>
        <span className='bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold'>
          {example.method}
        </span>
        <span className='text-muted-foreground ms-2 font-mono text-xs'>
          {brandConfig.apiBaseUrl}
          {example.endpoint}
        </span>
      </div>

      <div className='px-4 pt-4 sm:px-5'>
        <p className='type-label text-muted-foreground/70 mb-2 text-[10px]'>
          {t('Request')}
        </p>
        <div className='overflow-x-auto font-mono text-[0.72rem] leading-6 sm:text-[0.8rem]'>
          <pre aria-label={t('API request example')}>
            <code>
              <span className='text-success'>curl</span>{' '}
              <span className='text-muted-foreground'>-N -X POST</span>{' '}
              <span className='text-foreground'>
                {brandConfig.apiBaseUrl}
                {example.endpoint}
              </span>
              {' \\\n'}
              <span className='text-muted-foreground'> -H</span>{' '}
              <span className='text-foreground'>
                &quot;Authorization: Bearer ${brandConfig.apiKeyEnvName}&quot;
              </span>
              {' \\\n'}
              <span className='text-muted-foreground'> -d</span>{' '}
              <span className='text-foreground'>{"'{\n"}</span>
              {example.request.map((line) => (
                <span key={line} className='text-foreground'>
                  {line}
                  {'\n'}
                </span>
              ))}
              <span className='text-foreground'>{"}'"}</span>
            </code>
          </pre>
        </div>
      </div>

      <div className='border-border/70 mt-4 border-t px-4 pt-4 pb-1 sm:px-5'>
        <p className='type-label text-muted-foreground/70 mb-2 text-[10px]'>
          {t(example.responseLabel)}
        </p>
        <div className='overflow-x-auto font-mono text-[0.72rem] leading-6 sm:text-[0.8rem]'>
          <pre aria-label={t('API response example')}>
            <code className='text-muted-foreground'>
              {example.response.map((line) => (
                <span key={line} className='block'>
                  {line}
                </span>
              ))}
            </code>
          </pre>
        </div>
      </div>

      <div className='bg-muted/30 border-border text-muted-foreground mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-3 font-mono text-[11px] sm:px-5'>
        <span>{t('Neutral platform model aliases')}</span>
        <span className='ms-auto'>
          {example.id === 'chat' ? 'STREAM · SSE' : 'BUFFERED'}
        </span>
        <span className='data-value'>{brandConfig.apiBaseUrl}</span>
      </div>
    </div>
  )
}
