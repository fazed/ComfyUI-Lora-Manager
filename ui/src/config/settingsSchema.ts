/**
 * The settings sections of the new Settings page, mirroring the classic
 * settings modal (General, Interface, Library, Organization, ...). Every
 * field maps to one backend key; see utils/settingsModel.ts for the model and
 * ui/README.md ("Settings (phase B2b)") for what stays classic-only.
 */

import type { MessageKey } from '@/i18n'
import type { Draft, FieldDef, FieldOption } from '@/utils/settingsModel'
import { splitList } from '@/utils/settingsModel'

export type PanelId = 'appearance' | 'exampleImagesDownload' | 'metadataArchive' | 'backups' | 'about'

export interface SectionDef {
  id: string
  title: MessageKey
  description?: MessageKey
  fields: FieldDef[]
  /** Custom panels rendered after the fields. */
  panels?: PanelId[]
}

const opts = (...values: [string, string][]): FieldOption[] => values.map(([value, label]) => ({ value, label }))
const on = (key: string) => (draft: Draft) => draft[key] === true
const is = (key: string, ...values: string[]) => (draft: Draft) => values.includes(String(draft[key]))

export const LLM_PRESETS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
  deepseek: 'https://api.deepseek.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  'opencode-go': 'https://opencode.ai/zen/go/v1',
}

export const PATH_TEMPLATE_PRESETS = [
  '',
  '{base_model}',
  '{author}',
  '{first_tag}',
  '{base_model}/{first_tag}',
  '{base_model}/{author}',
  '{author}/{first_tag}',
  '{base_model}/{author}/{first_tag}',
]

export const OTHER_SUB_TYPES = ['vae', 'upscaler', 'text_encoder', 'clip_vision', 'controlnet'] as const

function noOverlap(draft: Draft): { key: MessageKey } | null {
  const checkpoints = new Set(splitList(String(draft['extra_folder_paths.checkpoints'] ?? '')).map((p) => p.replace(/\\/g, '/').toLowerCase()))
  const overlap = splitList(String(draft['extra_folder_paths.unet'] ?? '')).some((p) => checkpoints.has(p.replace(/\\/g, '/').toLowerCase()))
  return overlap ? { key: 'set.err.overlap' } : null
}

function balancedParens(value: unknown): { key: MessageKey } | null {
  let depth = 0
  for (const char of String(value)) {
    if (char === '(') depth++
    else if (char === ')' && --depth < 0) return { key: 'set.err.parens' }
  }
  return depth === 0 ? null : { key: 'set.err.parens' }
}

function proxyPort(value: unknown): { key: MessageKey } | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const port = Number(text)
  return /^\d+$/.test(text) && port >= 1 && port <= 65535 ? null : { key: 'set.err.port' }
}

function httpUrl(value: unknown): { key: MessageKey } | null {
  const text = String(value ?? '').trim()
  return !text || /^https?:\/\/\S+$/i.test(text) ? null : { key: 'set.err.url' }
}

const toggle = (key: string, label: MessageKey, extra: Partial<FieldDef> = {}): FieldDef => ({ key, type: 'toggle', label, ...extra })

export const SETTINGS_SECTIONS: SectionDef[] = [
  {
    id: 'general',
    title: 'set.section.general',
    panels: ['appearance'],
    fields: [
      {
        key: 'language',
        type: 'select',
        label: 'set.language',
        hint: 'set.language.hint',
        effect: 'classic-only',
        default: 'en',
        options: opts(['en', 'English'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['ru', 'Русский'], ['de', 'Deutsch'], ['ja', '日本語'], ['ko', '한국어'], ['fr', 'Français'], ['es', 'Español'], ['he', 'עברית']),
      },
      { key: 'civitai_api_key', type: 'secret', label: 'set.civitai_api_key', hint: 'set.civitai_api_key.hint', secretFlag: 'civitai_api_key_set' },
      { key: 'huggingface_api_key', type: 'secret', label: 'set.huggingface_api_key', hint: 'set.huggingface_api_key.hint', secretFlag: 'huggingface_api_key_set' },
      { key: 'civitai_host', type: 'select', label: 'set.civitai_host', default: 'civitai.com', options: opts(['civitai.com', 'civitai.com (SFW)'], ['civitai.red', 'civitai.red (unrestricted)']) },
      toggle('use_portable_settings', 'set.use_portable_settings', { hint: 'set.use_portable_settings.hint', effect: 'relocates-settings', confirm: 'set.use_portable_settings.confirm', default: false }),
    ],
  },
  {
    id: 'downloads',
    title: 'set.section.downloads',
    fields: [
      { key: 'download_queue_max_concurrent', type: 'number', label: 'set.download_queue_max_concurrent', hint: 'set.download_queue_max_concurrent.hint', integer: true, min: 1, max: 5, default: 2 },
      toggle('skip_previously_downloaded_model_versions', 'set.skip_previously_downloaded_model_versions', { default: false }),
      { key: 'download_backend', type: 'select', label: 'set.download_backend', default: 'python', options: opts(['python', 'Python (built-in)'], ['aria2', 'aria2']) },
      { key: 'aria2c_path', type: 'path', label: 'set.aria2c_path', hint: 'set.aria2c_path.hint', default: '', visibleWhen: is('download_backend', 'aria2') },
      { key: 'download_skip_base_models', type: 'list', label: 'set.download_skip_base_models', hint: 'set.download_skip_base_models.hint', default: [] },
      { key: 'unknown_base_model_routing', type: 'select', label: 'set.unknown_base_model_routing', default: 'diffusion_model', options: opts(['diffusion_model', 'Diffusion model (UNet) root'], ['checkpoint', 'Checkpoint root']) },
    ],
  },
  {
    id: 'ai',
    title: 'set.section.ai',
    description: 'set.section.ai.desc',
    fields: [
      {
        key: 'llm_provider',
        type: 'select',
        label: 'set.llm_provider',
        default: 'openai',
        options: opts(['openai', 'OpenAI'], ['ollama', 'Ollama (local)'], ['deepseek', 'DeepSeek'], ['groq', 'Groq'], ['openrouter', 'OpenRouter'], ['google', 'Gemini'], ['opencode-go', 'OpenCode Go'], ['custom', 'Custom']),
      },
      { key: 'llm_api_base', type: 'text', label: 'set.llm_api_base', hint: 'set.llm_api_base.hint', default: '', validate: httpUrl, placeholder: 'https://api.openai.com/v1' },
      { key: 'llm_api_key', type: 'secret', label: 'set.llm_api_key', secretFlag: 'llm_api_key_set' },
      { key: 'llm_model', type: 'text', label: 'set.llm_model', hint: 'set.llm_model.hint', default: '' },
    ],
  },
  {
    id: 'proxy',
    title: 'set.section.proxy',
    description: 'set.section.proxy.desc',
    fields: [
      toggle('proxy_enabled', 'set.proxy_enabled', { default: false }),
      { key: 'proxy_type', type: 'select', label: 'set.proxy_type', default: 'http', options: opts(['http', 'HTTP'], ['https', 'HTTPS'], ['socks4', 'SOCKS4'], ['socks5', 'SOCKS5']), visibleWhen: on('proxy_enabled') },
      { key: 'proxy_host', type: 'text', label: 'set.proxy_host', default: '', visibleWhen: on('proxy_enabled'), placeholder: '127.0.0.1' },
      { key: 'proxy_port', type: 'text', label: 'set.proxy_port', default: '', visibleWhen: on('proxy_enabled'), validate: proxyPort, placeholder: '8080' },
      { key: 'proxy_username', type: 'text', label: 'set.proxy_username', default: '', visibleWhen: on('proxy_enabled') },
      { key: 'proxy_password', type: 'secret', label: 'set.proxy_password', secretFlag: 'proxy_password_set', deleteMarker: true, visibleWhen: on('proxy_enabled') },
    ],
  },
  {
    id: 'interface',
    title: 'set.section.interface',
    description: 'set.section.interface.desc',
    fields: [
      toggle('blur_mature_content', 'set.blur_mature_content', { default: true }),
      toggle('show_only_sfw', 'set.show_only_sfw', { default: false }),
      { key: 'mature_blur_level', type: 'select', label: 'set.mature_blur_level', hint: 'set.mature_blur_level.hint', default: 'R', effect: 'classic-only', options: opts(['PG13', 'PG-13 and above'], ['R', 'R and above'], ['X', 'X and above'], ['XXX', 'XXX only']) },
      { key: 'lora_syntax_format', type: 'select', label: 'set.lora_syntax_format', hint: 'set.lora_syntax_format.hint', default: 'legacy', options: opts(['legacy', 'Legacy (file name only)'], ['full', 'Full (folder and file name)']) },
      toggle('include_trigger_words', 'set.include_trigger_words', { default: false }),
      { key: 'model_name_display', type: 'select', label: 'set.model_name_display', effect: 'classic-only', default: 'model_name', options: opts(['model_name', 'Model name'], ['file_name', 'File name']) },
      toggle('autoplay_on_hover', 'set.autoplay_on_hover', { effect: 'classic-only', default: false }),
      toggle('card_preview_cycle', 'set.card_preview_cycle', { effect: 'classic-only', default: true }),
      { key: 'card_preview_cycle_interval', type: 'number', label: 'set.card_preview_cycle_interval', effect: 'classic-only', min: 0.5, max: 3, step: 0.5, default: 2, visibleWhen: on('card_preview_cycle') },
      { key: 'display_density', type: 'select', label: 'set.display_density', effect: 'classic-only', default: 'default', options: opts(['default', 'Default'], ['medium', 'Medium'], ['compact', 'Compact']) },
      { key: 'recipes_layout', type: 'select', label: 'set.recipes_layout', effect: 'classic-only', default: 'grid', options: opts(['grid', 'Grid'], ['masonry', 'Masonry']) },
      toggle('group_by_model', 'set.group_by_model', { effect: 'classic-only', default: false }),
      toggle('sticky_controls', 'set.sticky_controls', { effect: 'classic-only', default: false }),
      { key: 'card_info_display', type: 'select', label: 'set.card_info_display', effect: 'classic-only', default: 'always', options: opts(['always', 'Always'], ['hover', 'On hover']) },
      { key: 'showcase_layout', type: 'select', label: 'set.showcase_layout', effect: 'classic-only', default: 'gallery', options: opts(['gallery', 'Gallery'], ['vertical', 'Vertical list']) },
      { key: 'card_blur_amount', type: 'number', label: 'set.card_blur_amount', effect: 'classic-only', integer: true, min: 0, max: 20, default: 8 },
      toggle('show_version_on_card', 'set.show_version_on_card', { effect: 'classic-only', default: true }),
      toggle('show_quantization_on_card', 'set.show_quantization_on_card', { effect: 'classic-only', default: true }),
      { key: 'model_card_footer_action', type: 'select', label: 'set.model_card_footer_action', effect: 'classic-only', default: 'replace_preview', options: opts(['replace_preview', 'Replace preview'], ['example_images', 'Example images folder']) },
      toggle('use_new_license_icons', 'set.use_new_license_icons', { effect: 'classic-only', default: true }),
      { key: 'send_to_workflow_exclusions.node_classes', type: 'list', label: 'set.send_to_workflow_exclusions.node_classes', hint: 'set.listHint', default: [] },
      { key: 'send_to_workflow_exclusions.title_patterns', type: 'list', label: 'set.send_to_workflow_exclusions.title_patterns', hint: 'set.listHint', default: [] },
    ],
  },
  {
    id: 'library',
    title: 'set.section.library',
    fields: [
      { key: 'default_lora_root', type: 'root', label: 'set.default_lora_root', rootsSource: 'loras', default: '' },
      { key: 'default_checkpoint_root', type: 'root', label: 'set.default_checkpoint_root', rootsSource: 'checkpoints', default: '' },
      { key: 'default_unet_root', type: 'root', label: 'set.default_unet_root', rootsSource: 'unet', default: '' },
      { key: 'default_embedding_root', type: 'root', label: 'set.default_embedding_root', rootsSource: 'embeddings', default: '' },
      toggle('enable_other_models', 'set.enable_other_models', { hint: 'set.enable_other_models.hint', effect: 'rebuilds-roots', default: false }),
      { key: 'enabled_other_sub_types', type: 'checkboxes', label: 'set.enabled_other_sub_types', options: OTHER_SUB_TYPES.map((value) => ({ value, label: value.replace('_', ' ') })), default: ['vae', 'upscaler', 'text_encoder'], visibleWhen: on('enable_other_models'), effect: 'rebuilds-roots' },
      ...OTHER_SUB_TYPES.map(
        (sub): FieldDef => ({
          key: `default_other_roots.${sub}`,
          type: 'root',
          label: `set.default_other_roots.${sub}` as MessageKey,
          rootsSource: `other:${sub}`,
          default: '',
          visibleWhen: (draft) => draft.enable_other_models === true && (draft.enabled_other_sub_types as string[]).includes(sub),
        }),
      ),
      toggle('enable_workflows', 'set.enable_workflows', { effect: 'rebuilds-roots', default: false }),
      { key: 'workflow_path', type: 'path', label: 'set.workflow_path', default: '', visibleWhen: on('enable_workflows'), effect: 'rebuilds-roots' },
      toggle('enable_wildcards', 'set.enable_wildcards', { effect: 'rebuilds-roots', default: false }),
      { key: 'wildcard_path', type: 'path', label: 'set.wildcard_path', default: '', visibleWhen: on('enable_wildcards'), effect: 'rebuilds-roots' },
      { key: 'recipes_path', type: 'path', label: 'set.recipes_path', hint: 'set.recipes_path.hint', effect: 'moves-files', confirm: 'set.recipes_path.confirm', default: '' },
      { key: 'extra_folder_paths.loras', type: 'list', label: 'set.extra_folder_paths.loras', hint: 'set.extra_folder_paths.hint', effect: 'restart', default: [] },
      { key: 'extra_folder_paths.checkpoints', type: 'list', label: 'set.extra_folder_paths.checkpoints', effect: 'restart', default: [], validate: (_v, draft) => noOverlap(draft) },
      { key: 'extra_folder_paths.unet', type: 'list', label: 'set.extra_folder_paths.unet', effect: 'restart', default: [], validate: (_v, draft) => noOverlap(draft) },
      { key: 'extra_folder_paths.embeddings', type: 'list', label: 'set.extra_folder_paths.embeddings', effect: 'restart', default: [] },
      { key: 'version_grouping', type: 'select', label: 'set.version_grouping', default: 'same_base', options: opts(['same_base', 'Same base model only'], ['any', 'Any base model']) },
      toggle('hide_early_access_updates', 'set.hide_early_access_updates', { default: false }),
      toggle('hide_paid_updates', 'set.hide_paid_updates', { default: false }),
      toggle('price_tracking_enabled', 'set.price_tracking_enabled', { default: false }),
      { key: 'price_check_ttl_hours', type: 'number', label: 'set.price_check_ttl_hours', integer: true, min: 1, max: 8760, default: 24, visibleWhen: on('price_tracking_enabled') },
    ],
  },
  {
    id: 'organization',
    title: 'set.section.organization',
    fields: [
      ...(['lora', 'checkpoint', 'embedding', 'workflow'] as const).map(
        (type): FieldDef => ({
          key: `download_path_templates.${type}`,
          type: 'pathTemplate',
          label: `set.download_path_templates.${type}` as MessageKey,
          hint: type === 'lora' ? 'set.download_path_templates.hint' : undefined,
          default: type === 'workflow' ? '' : '{base_model}/{first_tag}',
          visibleWhen: type === 'workflow' ? on('enable_workflows') : undefined,
        }),
      ),
      ...(['lora', 'checkpoint', 'embedding'] as const).map(
        (type): FieldDef => ({
          key: `download_filename_templates.${type}`,
          type: 'filenameTemplate',
          label: `set.download_filename_templates.${type}` as MessageKey,
          hint: type === 'lora' ? 'set.download_filename_templates.hint' : undefined,
          default: '',
        }),
      ),
      { key: 'base_model_path_mappings', type: 'map', label: 'set.base_model_path_mappings', hint: 'set.base_model_path_mappings.hint', default: {} },
      toggle('unsorted_fallback_enabled', 'set.unsorted_fallback_enabled', { default: false }),
      { key: 'unsorted_fallback_folder', type: 'text', label: 'set.unsorted_fallback_folder', default: 'unsorted', visibleWhen: on('unsorted_fallback_enabled') },
      ...(['lora', 'checkpoint', 'embedding'] as const).map(
        (type): FieldDef => ({
          key: `priority_tags.${type}`,
          type: 'textarea',
          label: `set.priority_tags.${type}` as MessageKey,
          hint: type === 'lora' ? 'set.priority_tags.hint' : undefined,
          validate: balancedParens,
        }),
      ),
      { key: 'auto_organize_exclusions', type: 'list', label: 'set.auto_organize_exclusions', hint: 'set.auto_organize_exclusions.hint', default: [] },
    ],
  },
  {
    id: 'example-images',
    title: 'set.section.exampleImages',
    description: 'set.section.exampleImages.desc',
    panels: ['exampleImagesDownload'],
    fields: [
      { key: 'example_images_path', type: 'path', label: 'set.example_images_path', hint: 'set.example_images_path.hint', effect: 'restart', default: '' },
      toggle('auto_download_example_images', 'set.auto_download_example_images', { hint: 'set.auto_download_example_images.hint', default: false }),
      toggle('optimize_example_images', 'set.optimize_example_images', { hint: 'set.optimize_example_images.hint', default: true }),
      { key: 'example_images_open_mode', type: 'select', label: 'set.example_images_open_mode', default: 'system', options: opts(['system', 'Open in the file explorer (on the server)'], ['clipboard', 'Copy the path'], ['uri_template', 'Open a custom URI']) },
      { key: 'example_images_local_root', type: 'path', label: 'set.example_images_local_root', hint: 'set.example_images_local_root.hint', default: '', visibleWhen: is('example_images_open_mode', 'clipboard', 'uri_template') },
      { key: 'example_images_open_uri_template', type: 'text', label: 'set.example_images_open_uri_template', hint: 'set.example_images_open_uri_template.hint', default: '', visibleWhen: is('example_images_open_mode', 'uri_template') },
    ],
  },
  {
    id: 'metadata',
    title: 'set.section.metadata',
    panels: ['metadataArchive'],
    fields: [
      toggle('enable_civarchive_api', 'set.enable_civarchive_api', { default: true }),
      toggle('enable_openmodeldb_api', 'set.enable_openmodeldb_api', { default: true }),
      toggle('enable_metadata_archive_db', 'set.enable_metadata_archive_db', { hint: 'set.enable_metadata_archive_db.hint', default: false }),
      { key: 'metadata_provider_order', type: 'select', label: 'set.metadata_provider_order', default: 'civitai_archive_sqlite', options: opts(['civitai_archive_sqlite', 'Civitai, then CivArchive, then the archive database'], ['civitai_sqlite_archive', 'Civitai, then the archive database, then CivArchive']) },
      { key: 'metadata_refresh_skip_paths', type: 'list', label: 'set.metadata_refresh_skip_paths', hint: 'set.listHint', default: [] },
    ],
  },
  {
    id: 'backups',
    title: 'set.section.backups',
    description: 'set.section.backups.desc',
    panels: ['backups'],
    fields: [
      toggle('backup_auto_enabled', 'set.backup_auto_enabled', { default: true }),
      { key: 'backup_retention_count', type: 'number', label: 'set.backup_retention_count', hint: 'set.backup_retention_count.hint', integer: true, min: 1, max: 365, default: 5 },
    ],
  },
  { id: 'about', title: 'set.section.about', panels: ['about'], fields: [] },
]

export const ALL_FIELDS: FieldDef[] = SETTINGS_SECTIONS.flatMap((section) => section.fields)
