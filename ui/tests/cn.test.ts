/**
 * cn() merges class lists with knowledge of the project's token utilities
 * (styles/tokens.css): colour and size utilities that share a prefix are
 * different groups, same-group utilities resolve to the last one.
 */
import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('keeps a token colour and a token font size together', () => {
    expect(cn('text-fg', 'text-md')).toBe('text-fg text-md')
    expect(cn('text-on-accent', 'text-2xl')).toBe('text-on-accent text-2xl')
    expect(cn('text-muted text-xs', 'text-sm')).toBe('text-muted text-sm')
  })

  it('lets the last utility of a group win', () => {
    expect(cn('text-fg', 'text-muted')).toBe('text-muted')
    expect(cn('bg-surface', 'bg-elevated')).toBe('bg-elevated')
    expect(cn('border-l-info', 'border-l-danger')).toBe('border-l-danger')
    expect(cn('rounded-md', 'rounded-pill')).toBe('rounded-pill')
    expect(cn('shadow-sm', 'shadow-lg')).toBe('shadow-lg')
    expect(cn('h-control', 'h-control-sm')).toBe('h-control-sm')
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('hairline', 'border-0')).toBe('border-0')
  })

  it('keeps unrelated utilities and handles clsx inputs', () => {
    expect(cn('hairline border-border', { 'bg-sunken': true, 'text-danger': false }, ['gap-2'])).toBe('hairline border-border bg-sunken gap-2')
  })
})
