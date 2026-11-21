/** Compact tag list: show the first few tags and collapse the rest behind "+N more". */

export const TAG_COLLAPSE_LIMIT = 12

export interface CollapsedTags {
  visible: string[]
  hiddenCount: number
  /** True when there is anything to expand or collapse. */
  collapsible: boolean
}

export function collapseTags(tags: readonly string[], expanded: boolean, limit = TAG_COLLAPSE_LIMIT): CollapsedTags {
  const max = Math.max(0, limit)
  // A single hidden tag is not worth a "+1 more" button: show it instead.
  const collapsible = tags.length > max + 1
  if (expanded || !collapsible) return { visible: [...tags], hiddenCount: 0, collapsible }
  return { visible: tags.slice(0, max), hiddenCount: tags.length - max, collapsible }
}
