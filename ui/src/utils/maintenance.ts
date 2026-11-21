/**
 * Doctor, backups and metadata archive (phase B2b): response normalisation
 * and the texts/rules of the confirms. See ui/README.md for what every fix
 * and restore does on disk.
 */

export type CheckStatus = 'ok' | 'warning' | 'error'

export interface DoctorAction {
  id: string
  label: string
}

export interface DoctorDetail {
  kind: 'text' | 'conflicts' | 'version' | 'cache' | 'other'
  text: string
  status?: CheckStatus
}

export interface DoctorCheck {
  id: string
  title: string
  status: CheckStatus
  summary: string
  details: DoctorDetail[]
  actions: DoctorAction[]
}

export interface DoctorReport {
  status: CheckStatus
  issueCount: number
  checkedAt: string
  appVersion: string
  checks: DoctorCheck[]
  conflicts: { groups: number; files: number }
}

const rec = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
const asStatus = (value: unknown): CheckStatus => (value === 'error' || value === 'warning' ? value : 'ok')

export function describeDetail(raw: unknown): DoctorDetail {
  if (typeof raw === 'string') return { kind: 'text', text: raw }
  const detail = rec(raw)
  if ('conflict_groups' in detail) {
    return { kind: 'conflicts', text: `Conflicts: ${Number(detail.conflict_groups) || 0} file names, ${Number(detail.total_conflict_files) || 0} files` }
  }
  if ('client_version' in detail || 'server_version' in detail) {
    return { kind: 'version', text: `Page: ${String(detail.client_version ?? '-')} / Server: ${String(detail.server_version ?? '-')}` }
  }
  if ('model_type' in detail) {
    const parts = [String(detail.label ?? detail.model_type), String(detail.message ?? '')].filter(Boolean)
    if (detail.corruption_rate) parts.push(`${String(detail.corruption_rate)} invalid`)
    return { kind: 'cache', text: parts.join(' - '), status: asStatus(detail.status) }
  }
  return { kind: 'other', text: JSON.stringify(raw) }
}

export function normaliseDoctor(raw: unknown): DoctorReport {
  const payload = rec(raw)
  const summary = rec(payload.summary)
  const checks = (Array.isArray(payload.diagnostics) ? payload.diagnostics : []).map(rec).map((item) => ({
    id: String(item.id ?? ''),
    title: String(item.title ?? item.id ?? ''),
    status: asStatus(item.status),
    summary: String(item.summary ?? ''),
    details: (Array.isArray(item.details) ? item.details : []).map(describeDetail),
    actions: (Array.isArray(item.actions) ? item.actions : []).map(rec).map((a) => ({ id: String(a.id ?? ''), label: String(a.label ?? a.id ?? '') })),
  }))
  const rawConflicts = (Array.isArray(payload.diagnostics) ? payload.diagnostics : []).map(rec).find((c) => c.id === 'filename_conflicts')
  const conflictDetail = rec((Array.isArray(rawConflicts?.details) ? rawConflicts.details : []).find((d) => 'conflict_groups' in rec(d)))
  return {
    status: asStatus(summary.status),
    issueCount: Number(summary.issue_count) || checks.filter((c) => c.status !== 'ok').length,
    checkedAt: String(summary.checked_at ?? ''),
    appVersion: String(payload.app_version ?? ''),
    checks,
    conflicts: { groups: Number(conflictDetail.conflict_groups) || 0, files: Number(conflictDetail.total_conflict_files) || 0 },
  }
}

/** Actions the new UI runs itself; anything else is shown as a link to the classic UI. */
export type ActionKind = 'repair-cache' | 'resolve-filename-conflicts' | 'open-settings' | 'open-settings-syntax-format' | 'reload-page' | 'unknown'

export function actionKind(id: string): ActionKind {
  return (['repair-cache', 'resolve-filename-conflicts', 'open-settings', 'open-settings-syntax-format', 'reload-page'] as const).find((k) => k === id) ?? 'unknown'
}

/** Fixes that touch the server and need an explicit confirm. */
export function needsConfirm(id: string): boolean {
  return id === 'repair-cache' || id === 'resolve-filename-conflicts'
}

// --------------------------------------------------------------------------- backups

export interface BackupSnapshot {
  name: string
  path: string
  size: number
  mtime: number
  auto: boolean
}

export interface BackupStatus {
  backupDir: string
  enabled: boolean
  retentionCount: number
  snapshotCount: number
  latestAuto: BackupSnapshot | null
  snapshots: BackupSnapshot[]
}

function snapshot(raw: unknown): BackupSnapshot | null {
  const item = rec(raw)
  if (!item.name) return null
  return { name: String(item.name), path: String(item.path ?? ''), size: Number(item.size) || 0, mtime: Number(item.mtime) || 0, auto: !!item.is_auto }
}

export function normaliseBackupStatus(raw: unknown): BackupStatus {
  const payload = rec(raw)
  const status = rec(payload.status)
  const snapshots = (Array.isArray(payload.snapshots) ? payload.snapshots : []).map(snapshot).filter((s): s is BackupSnapshot => !!s)
  snapshots.sort((a, b) => b.mtime - a.mtime)
  return {
    backupDir: String(status.backupDir ?? ''),
    enabled: status.enabled !== false,
    retentionCount: Number(status.retentionCount) || 0,
    snapshotCount: Number(status.snapshotCount ?? snapshots.length) || 0,
    latestAuto: snapshot(status.latestAutoSnapshot),
    snapshots,
  }
}

/** `attachment; filename="x.zip"` -> `x.zip` (no path parts). */
export function filenameFromDisposition(header: string | null | undefined, fallback: string): string {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header ?? '')
  const name = match ? decodeURIComponent(match[1]).split(/[\\/]/).pop() ?? '' : ''
  return name.trim() || fallback
}

export const RESTORED_FILES = [
  'settings.json (all settings, including API keys)',
  'download history (downloaded_versions.sqlite)',
  'symlink map (symlink_map.json)',
  'model update state (model_update/*.sqlite)',
  'usage statistics (lora_manager_stats.json)',
] as const

/** Client-side checks before an upload; the server validates the manifest and checksums. */
export function validateBackupFile(file: { name: string; size: number } | null): string | null {
  if (!file) return 'Choose a backup file first.'
  if (!/\.zip$/i.test(file.name)) return 'A LoRA Manager backup is a .zip file.'
  if (file.size <= 0) return 'The file is empty.'
  return null
}

/** The restore confirm requires typing this word. */
export const RESTORE_CONFIRM_WORD = 'RESTORE'

export function restoreConfirmed(typed: string): boolean {
  return typed.trim() === RESTORE_CONFIRM_WORD
}

// --------------------------------------------------------------------------- metadata archive

export interface ArchiveStatus {
  available: boolean
  enabled: boolean
  size: number
  path: string
}

export function normaliseArchiveStatus(raw: unknown): ArchiveStatus {
  const payload = rec(raw)
  return {
    available: !!payload.isAvailable,
    enabled: !!payload.isEnabled,
    size: Number(payload.databaseSize) || 0,
    path: String(payload.databasePath ?? ''),
  }
}

// --------------------------------------------------------------------------- environment / updates

export interface EnvironmentInfo {
  app: string
  comfyui: string
  frontend: string
  python: string
  platform: string
  standalone: boolean
}

export function normaliseEnvironment(raw: unknown): EnvironmentInfo {
  const env = rec(rec(raw).environment ?? raw)
  const text = (value: unknown) => (value === null || value === undefined || value === '' ? 'Unavailable' : String(value))
  return {
    app: text(env.app_version),
    comfyui: text(env.comfyui_version),
    frontend: text(env.frontend_version),
    python: text(env.python_version),
    platform: text(env.platform),
    standalone: !!env.standalone,
  }
}

export function environmentMarkdown(env: EnvironmentInfo, browser: string): string {
  return [
    '**Environment**',
    `- LoRA Manager: ${env.app}`,
    `- ComfyUI: ${env.comfyui}`,
    `- ComfyUI Frontend: ${env.frontend}`,
    `- Python: ${env.python}`,
    `- OS: ${env.platform}`,
    `- Browser: ${browser || 'Unavailable'}`,
  ].join('\n')
}

export interface UpdateInfo {
  current: string
  latest: string
  available: boolean
  changelog: string[]
  error: string
}

export function normaliseUpdate(raw: unknown): UpdateInfo {
  const payload = rec(raw)
  return {
    current: String(payload.current_version ?? ''),
    latest: String(payload.latest_version ?? ''),
    available: !!payload.update_available,
    changelog: Array.isArray(payload.changelog) ? payload.changelog.map(String).slice(0, 12) : [],
    error: payload.success === false ? String(payload.error ?? 'Update check failed') : '',
  }
}
