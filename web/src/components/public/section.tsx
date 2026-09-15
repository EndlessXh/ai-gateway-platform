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
 * Shared building blocks for the public marketing surface.
 *
 * These exist so the landing page, pricing page and auth pages share one
 * section rhythm and one heading scale. Before this, each section re-declared
 * its own eyebrow/title/lede markup and they had drifted apart.
 */
import { cn } from '@/lib/utils'

type PublicSectionHeaderProps = {
  eyebrow?: string
  title: React.ReactNode
  lede?: React.ReactNode
  /** Places the lede beside the title instead of beneath it. */
  side?: boolean
  align?: 'start' | 'center'
  className?: string
}

export function PublicSectionHeader(props: PublicSectionHeaderProps) {
  const align = props.align ?? 'start'

  const heading = (
    <div className={align === 'center' ? 'mx-auto max-w-3xl text-center' : ''}>
      {props.eyebrow ? (
        <p className='type-label text-brand-accent mb-4'>{props.eyebrow}</p>
      ) : null}
      <h2 className='type-section-title max-w-3xl data-[center=true]:mx-auto'>
        {props.title}
      </h2>
      {props.lede && !props.side ? (
        <p
          className={cn(
            'text-muted-foreground mt-4 max-w-2xl text-sm leading-6 md:text-base md:leading-7',
            align === 'center' && 'mx-auto'
          )}
        >
          {props.lede}
        </p>
      ) : null}
    </div>
  )

  if (props.side && props.lede) {
    return (
      /*
        The title column used to be 0.8fr against a 1.2fr lede, which resolved
        to 502px — at *both* 1440 and 1920, because `--container-content` caps
        at 84rem. `type-section-title` however keeps growing with `vw`
        (42px at 1440, 44px at 1920), so at 1920 a 12-character Chinese
        heading no longer fitted and broke mid-compound, between 打 and 造.

        The heading is the primary element here and the lede is a single short
        sentence, so the ratio is inverted: the title now gets the wider
        column and the lede the narrower one. Both stay `minmax(0,...)` so
        neither can force overflow.
      */
      <div
        className={cn(
          'grid gap-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:items-end',
          props.className
        )}
      >
        {heading}
        <p className='text-muted-foreground max-w-2xl text-sm leading-6 md:justify-self-end md:text-base md:leading-7'>
          {props.lede}
        </p>
      </div>
    )
  }

  return <div className={props.className}>{heading}</div>
}

/**
 * A panel in the capability grid.
 *
 * `children` is the panel's own visual — protocol chips, a small list, a
 * status row. Panels deliberately differ in what they contain: a grid where
 * every cell is icon + title + one line reads as a template, which is the
 * thing this layout is meant to avoid.
 */
export function PublicFeaturePanel(props: {
  index: string
  title: string
  description: string
  /**
   * Marks a panel as a primary one. The grid already gives these more width;
   * this gives them more type weight too. Without it the wide and narrow
   * panels differed only in span, which at 1920 read as one uniform set of
   * cards stretched across a wider canvas.
   */
  emphasis?: boolean
  children?: React.ReactNode
  className?: string
}) {
  return (
    <article
      className={cn(
        'border-border/60 bg-card/50 flex flex-col rounded-2xl border backdrop-blur transition-colors',
        'hover:border-border hover:bg-card/70',
        // Internals step up on large screens; mobile and tablet are unchanged.
        'p-6 lg:p-7 xl:p-8',
        props.className
      )}
    >
      <div className='flex items-baseline gap-3'>
        <span className='data-value text-primary/70 text-xs font-semibold lg:text-sm'>
          {props.index}
        </span>
        <h3
          className={cn(
            'font-semibold',
            props.emphasis
              ? 'text-lg lg:text-xl xl:text-2xl'
              : 'text-base lg:text-lg'
          )}
        >
          {props.title}
        </h3>
      </div>
      <p
        className={cn(
          'text-muted-foreground mt-3 text-sm leading-6',
          props.emphasis && 'lg:text-base lg:leading-7'
        )}
      >
        {props.description}
      </p>
      {props.children ? (
        <div className='mt-5 lg:mt-6'>{props.children}</div>
      ) : null}
    </article>
  )
}

/** Small monospace chip used inside capability panels for routes and formats. */
export function PublicChip(props: {
  children: React.ReactNode
  mono?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'border-border/70 bg-background/60 inline-flex items-center rounded-md border px-2 py-1 text-xs',
        props.mono && 'data-value',
        props.className
      )}
    >
      {props.children}
    </span>
  )
}
