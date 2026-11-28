/**
 * Letters of the alphabet bar. The values are the backend's `first_letter`
 * buckets (py/services/lora_service.py `_filter_by_first_letter`): A-Z match
 * the first character of the model name case-insensitively, `#` a digit, `@`
 * any other non-alphanumeric character and `漢` a CJK character.
 */

import type { MessageKey } from '@/i18n'

export const ALPHABET: string[] = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '@', '漢']

const SPECIAL: Record<string, MessageKey> = { '#': 'alpha.digits', '@': 'alpha.other', 漢: 'alpha.cjk' }

/** Message key and params of a letter's accessible name. */
export function letterLabel(letter: string): { key: MessageKey; params?: Record<string, string> } {
  const key = SPECIAL[letter]
  return key ? { key } : { key: 'alpha.letter', params: { letter } }
}
