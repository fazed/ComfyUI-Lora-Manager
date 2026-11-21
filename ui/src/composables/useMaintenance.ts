/**
 * Doctor, backups and the metadata archive (phase B2b). Every action that
 * changes the server asks first; the restore needs the typed confirm word
 * (checked again here, not only in the dialog).
 */

import { ref, shallowRef } from 'vue'
import { archiveApi, backupApi, doctorApi, saveBlob, systemApi } from '@/api/maintenance'
import { useConfirm, useToasts } from '@/composables/useFeedback'
import {
  filenameFromDisposition,
  normaliseArchiveStatus,
  normaliseBackupStatus,
  normaliseDoctor,
  restoreConfirmed,
  validateBackupFile,
  type ArchiveStatus,
  type BackupStatus,
  type DoctorReport,
} from '@/utils/maintenance'
import { formatBytes } from '@/utils/format'
import { t } from '@/i18n'

/**
 * The doctor's ui_version check compares the page's version with the server's
 * (it targets stale classic bundles). The new UI is served by the same
 * backend, so it reports the server version it was loaded from.
 */
let clientVersion: string | null = null
async function pageVersion(): Promise<string> {
  if (clientVersion === null) {
    try {
      clientVersion = (await systemApi.versionInfo()).version || ''
    } catch {
      clientVersion = ''
    }
  }
  return clientVersion
}

export function useDoctor() {
  const toasts = useToasts()
  const { confirm } = useConfirm()
  const report = shallowRef<DoctorReport | null>(null)
  const raw = shallowRef<Record<string, unknown> | null>(null)
  const loading = ref(false)
  const busy = ref<string | null>(null)
  const error = ref<string | null>(null)

  async function run(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      raw.value = await doctorApi.diagnostics(await pageVersion())
      report.value = normaliseDoctor(raw.value)
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      loading.value = false
    }
  }

  async function repairCache(): Promise<boolean> {
    const ok = await confirm({ title: t('doctor.repairTitle'), message: t('doctor.repairMessage'), confirmLabel: t('doctor.repairConfirm') })
    if (!ok) return false
    busy.value = 'repair-cache'
    try {
      const result = await doctorApi.repairCache()
      toasts.success(t('doctor.repaired', { count: result.repaired?.length ?? 0 }))
      await run()
      return true
    } catch (err) {
      toasts.error(t('doctor.repairFailed', { error: (err as Error).message }))
      return false
    } finally {
      busy.value = null
    }
  }

  async function resolveConflicts(): Promise<boolean> {
    const conflicts = report.value?.conflicts ?? { groups: 0, files: 0 }
    if (!conflicts.groups) {
      toasts.push(t('doctor.noConflicts'))
      return false
    }
    const ok = await confirm({
      title: t('doctor.resolveTitle'),
      message: t('doctor.resolveMessage', { files: conflicts.files, groups: conflicts.groups }),
      confirmLabel: t('doctor.resolveConfirm'),
      danger: true,
    })
    if (!ok) return false
    busy.value = 'resolve-filename-conflicts'
    try {
      const result = await doctorApi.resolveConflicts()
      toasts.success(t('doctor.resolved', { count: result.count ?? 0 }))
      await run()
      return true
    } catch (err) {
      toasts.error(t('doctor.resolveFailed', { error: (err as Error).message }))
      return false
    } finally {
      busy.value = null
    }
  }

  async function exportBundle(): Promise<boolean> {
    busy.value = 'export'
    try {
      const { blob, disposition } = await doctorApi.exportBundle({
        summary: raw.value?.summary ?? {},
        diagnostics: raw.value?.diagnostics ?? [],
        frontend_logs: [],
        client_context: { url: location.href, user_agent: navigator.userAgent, language: navigator.language, app_version: await pageVersion() },
      })
      saveBlob(blob, filenameFromDisposition(disposition, 'lora-manager-doctor.zip'))
      return true
    } catch (err) {
      toasts.error(t('doctor.exportFailed', { error: (err as Error).message }))
      return false
    } finally {
      busy.value = null
    }
  }

  return { report, loading, busy, error, run, repairCache, resolveConflicts, exportBundle }
}

export function useBackups() {
  const toasts = useToasts()
  const status = shallowRef<BackupStatus | null>(null)
  const loading = ref(false)
  const busy = ref<string | null>(null)
  const error = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      status.value = normaliseBackupStatus(await backupApi.status())
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      loading.value = false
    }
  }

  /** Builds a fresh snapshot and downloads it; nothing is kept on the server. */
  async function exportNow(): Promise<boolean> {
    busy.value = 'export'
    try {
      const { blob, disposition } = await backupApi.export()
      const name = filenameFromDisposition(disposition, 'lora-manager-backup.zip')
      saveBlob(blob, name)
      toasts.success(t('backups.exported', { name, size: formatBytes(blob.size) }))
      return true
    } catch (err) {
      toasts.error(t('backups.exportFailed', { error: (err as Error).message }))
      return false
    } finally {
      busy.value = null
    }
  }

  /** Overwrites the live user state; only after the typed confirm. */
  async function restore(file: File | null, typed: string): Promise<boolean> {
    const invalid = validateBackupFile(file)
    if (invalid) {
      error.value = invalid
      return false
    }
    if (!restoreConfirmed(typed)) {
      error.value = t('backups.typeToConfirm')
      return false
    }
    busy.value = 'restore'
    error.value = null
    try {
      const result = await backupApi.restore(file!)
      toasts.warning(t('backups.restored', { count: result.restored_files ?? 0 }))
      await load()
      return true
    } catch (err) {
      error.value = t('backups.restoreFailed', { error: (err as Error).message })
      return false
    } finally {
      busy.value = null
    }
  }

  async function openFolder(): Promise<void> {
    try {
      const result = await backupApi.openFolder()
      if (result.mode === 'clipboard' && result.path) toasts.push(t('examples.pathIs', { path: result.path }))
      else toasts.push(t('examples.folderOpened'))
    } catch (err) {
      toasts.error((err as Error).message)
    }
  }

  return { status, loading, busy, error, load, exportNow, restore, openFolder }
}

export function useMetadataArchive() {
  const toasts = useToasts()
  const { confirm } = useConfirm()
  const status = shallowRef<ArchiveStatus | null>(null)
  const busy = ref<'download' | 'remove' | null>(null)
  const error = ref<string | null>(null)

  async function load(): Promise<void> {
    try {
      status.value = normaliseArchiveStatus(await archiveApi.status())
      error.value = null
    } catch (err) {
      error.value = (err as Error).message
    }
  }

  async function download(): Promise<boolean> {
    const ok = await confirm({ title: t('archive.downloadTitle'), message: t('archive.downloadMessage'), confirmLabel: t('archive.downloadConfirm') })
    if (!ok) return false
    busy.value = 'download'
    try {
      await archiveApi.download(`metadata_archive_${Date.now()}`)
      toasts.success(t('archive.downloaded'))
      await load()
      return true
    } catch (err) {
      toasts.error(t('archive.downloadFailed', { error: (err as Error).message }))
      return false
    } finally {
      busy.value = null
    }
  }

  async function remove(): Promise<boolean> {
    const ok = await confirm({ title: t('archive.removeTitle'), message: t('archive.removeMessage'), confirmLabel: t('archive.removeConfirm'), danger: true })
    if (!ok) return false
    busy.value = 'remove'
    try {
      await archiveApi.remove()
      toasts.success(t('archive.removed'))
      await load()
      return true
    } catch (err) {
      toasts.error(t('archive.removeFailed', { error: (err as Error).message }))
      return false
    } finally {
      busy.value = null
    }
  }

  return { status, busy, error, load, download, remove }
}
