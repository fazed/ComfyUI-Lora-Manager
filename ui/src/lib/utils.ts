/**
 * `cn()` for the shadcn-vue primitives in components/ui/: clsx + a
 * tailwind-merge that knows this project's token utilities (styles/tokens.css),
 * so `text-fg text-md` keeps both (colour + size) while `h-control h-control-sm`
 * keeps the last one.
 */
import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  override: {
    theme: {
      color: [
        'page', 'surface', 'elevated', 'sunken', 'border', 'border-strong', 'fg', 'muted',
        'accent', 'accent-hover', 'accent-soft', 'on-accent', 'danger', 'danger-soft', 'on-danger',
        'success', 'success-soft', 'warning', 'warning-soft', 'info', 'info-soft', 'focus',
        'field', 'field-hover', 'field-border', 'field-border-hover', 'field-disabled', 'placeholder',
        'overlay', 'scrim', 'on-scrim', 'skeleton', 'shadow',
        'series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6',
        'transparent', 'current', 'inherit',
      ],
      text: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
      radius: ['sm', 'md', 'lg', 'pill'],
      shadow: ['sm', 'md', 'lg'],
    },
  },
  extend: {
    theme: {
      spacing: ['control', 'control-sm', 'touch', 'rail', 'folders', 'drawer', 'card'],
    },
    classGroups: {
      'border-w': ['hairline'],
      'border-w-t': ['hairline-t'],
      'border-w-r': ['hairline-r'],
      'border-w-b': ['hairline-b'],
      'border-w-l': ['hairline-l'],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
