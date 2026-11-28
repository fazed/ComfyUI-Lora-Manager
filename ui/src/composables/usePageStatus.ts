/**
 * What the browse page shows in the app's status bar (components/StatusBar.vue):
 * the result count text and the selection size. One page at a time publishes
 * it while mounted; other pages leave the fields empty.
 */

import { onBeforeUnmount, reactive, readonly, watchEffect } from 'vue'

const status = reactive({ count: '', selected: 0 })

export const pageStatus = readonly(status)

export function usePageStatus(source: () => { count: string; selected: number }): void {
  watchEffect(() => Object.assign(status, source()))
  onBeforeUnmount(() => Object.assign(status, { count: '', selected: 0 }))
}
