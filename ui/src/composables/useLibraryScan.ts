/**
 * Rescan step of the browse pages' manual Refresh: reports the `scanning`
 * phase, runs the library scan (utils/libraryScan.ts) and shows its toast
 * (changes found, scan skipped, scan failed). A failed scan does not stop the
 * refresh: the page still reloads what the server has.
 */

import type { RefreshContext } from './useRefresh'
import { useToasts } from './useFeedback'
import { runLibraryScan, scanNotice, type ScanDeps } from '@/utils/libraryScan'
import { t } from '@/i18n'

export async function scanBeforeRefresh(context: RefreshContext, deps: ScanDeps): Promise<void> {
  if (context.silent) return
  context.setPhase('scanning')
  try {
    const outcome = await runLibraryScan(deps)
    const notice = scanNotice(outcome, {
      added: (count) => t('refresh.added', { count: count.toLocaleString() }),
      removed: (count) => t('refresh.removed', { count: count.toLocaleString() }),
    })
    if (notice) useToasts().push(t(notice.key, notice.params), notice.kind)
  } finally {
    context.setPhase('loading')
  }
}
