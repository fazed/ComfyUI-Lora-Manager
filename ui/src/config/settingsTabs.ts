/**
 * Presentation of the Settings page: which tab and which card each field of
 * config/settingsSchema.ts lives in. The schema (keys, types, defaults,
 * validation, save order) is untouched; this file only groups it. Every
 * schema field appears in exactly one card (tests/settingsTabs.test.ts).
 */

/** Icons of AppIcon.vue used by the tabs (.ts files cannot import types from .vue). */
export type SettingsTabIcon = 'settings' | 'palette' | 'folder' | 'download' | 'image' | 'book' | 'link' | 'archive' | 'sparkle'
import type { PanelId } from '@/config/settingsSchema'
import type { MessageKey } from '@/i18n'

/** Non-form blocks rendered inside a card (after its fields). */
export type SettingsPanelId = PanelId | 'settingsFile' | 'diagnostics'

export interface CardDef {
  id: string
  title: MessageKey
  description?: MessageKey
  /** Schema keys, in display order. */
  fields: string[]
  panels?: SettingsPanelId[]
  /** 'danger': settings with side effects on disk (moves files, relocates settings). */
  tone?: 'danger'
  /** Extra English search words for panels (they have no field labels to match). */
  keywords?: string
}

export interface TabDef {
  id: string
  title: MessageKey
  description: MessageKey
  icon: SettingsTabIcon
  cards: CardDef[]
}

const OTHER = ['vae', 'upscaler', 'text_encoder', 'clip_vision', 'controlnet'].map((sub) => `default_other_roots.${sub}`)

export const SETTINGS_TABS: TabDef[] = [
  {
    id: 'general',
    title: 'setTab.general',
    description: 'setTab.general.desc',
    icon: 'settings',
    cards: [
      { id: 'language', title: 'setCard.language', fields: ['language'] },
      { id: 'content', title: 'setCard.content', description: 'setCard.content.desc', fields: ['blur_mature_content', 'show_only_sfw', 'mature_blur_level'] },
      {
        id: 'settings-file',
        title: 'setCard.settingsFile',
        description: 'setCard.settingsFile.desc',
        tone: 'danger',
        fields: ['use_portable_settings'],
        panels: ['settingsFile'],
        keywords: 'settings.json location folder portable',
      },
    ],
  },
  {
    id: 'interface',
    title: 'setTab.interface',
    description: 'setTab.interface.desc',
    icon: 'palette',
    cards: [
      { id: 'appearance', title: 'setCard.appearance', description: 'setCard.appearance.desc', fields: [], panels: ['appearance'], keywords: 'theme dark light midnight density compact custom' },
      {
        id: 'prompts',
        title: 'setCard.prompts',
        description: 'setCard.prompts.desc',
        fields: ['lora_syntax_format', 'include_trigger_words', 'send_to_workflow_exclusions.node_classes', 'send_to_workflow_exclusions.title_patterns'],
      },
      {
        id: 'classic-display',
        title: 'setCard.classicDisplay',
        description: 'setCard.classicDisplay.desc',
        fields: [
          'model_name_display',
          'display_density',
          'card_info_display',
          'show_version_on_card',
          'show_quantization_on_card',
          'use_new_license_icons',
          'model_card_footer_action',
          'card_blur_amount',
          'autoplay_on_hover',
          'card_preview_cycle',
          'card_preview_cycle_interval',
          'recipes_layout',
          'showcase_layout',
          'group_by_model',
          'sticky_controls',
        ],
      },
    ],
  },
  {
    id: 'library',
    title: 'setTab.library',
    description: 'setTab.library.desc',
    icon: 'folder',
    cards: [
      { id: 'roots', title: 'setCard.roots', description: 'setCard.roots.desc', fields: ['default_lora_root', 'default_checkpoint_root', 'default_unet_root', 'default_embedding_root'] },
      { id: 'other-models', title: 'setCard.otherModels', fields: ['enable_other_models', 'enabled_other_sub_types', ...OTHER] },
      { id: 'workflows', title: 'setCard.workflows', fields: ['enable_workflows', 'workflow_path', 'enable_wildcards', 'wildcard_path'] },
      {
        id: 'extra-paths',
        title: 'setCard.extraPaths',
        description: 'setCard.extraPaths.desc',
        fields: ['extra_folder_paths.loras', 'extra_folder_paths.checkpoints', 'extra_folder_paths.unet', 'extra_folder_paths.embeddings'],
      },
      { id: 'recipes', title: 'setCard.recipes', description: 'setCard.recipes.desc', tone: 'danger', fields: ['recipes_path'] },
    ],
  },
  {
    id: 'downloads',
    title: 'setTab.downloads',
    description: 'setTab.downloads.desc',
    icon: 'download',
    cards: [
      {
        id: 'queue',
        title: 'setCard.queue',
        fields: ['download_queue_max_concurrent', 'skip_previously_downloaded_model_versions', 'download_backend', 'aria2c_path', 'download_skip_base_models', 'unknown_base_model_routing'],
      },
      {
        id: 'folder-templates',
        title: 'setCard.folderTemplates',
        description: 'setCard.folderTemplates.desc',
        fields: ['download_path_templates.lora', 'download_path_templates.checkpoint', 'download_path_templates.embedding', 'download_path_templates.workflow'],
      },
      {
        id: 'filename-templates',
        title: 'setCard.filenameTemplates',
        description: 'setCard.filenameTemplates.desc',
        fields: ['download_filename_templates.lora', 'download_filename_templates.checkpoint', 'download_filename_templates.embedding'],
      },
      {
        id: 'sorting',
        title: 'setCard.sorting',
        description: 'setCard.sorting.desc',
        fields: ['base_model_path_mappings', 'unsorted_fallback_enabled', 'unsorted_fallback_folder', 'priority_tags.lora', 'priority_tags.checkpoint', 'priority_tags.embedding', 'auto_organize_exclusions'],
      },
    ],
  },
  {
    id: 'example-images',
    title: 'setTab.exampleImages',
    description: 'setTab.exampleImages.desc',
    icon: 'image',
    cards: [
      { id: 'example-storage', title: 'setCard.exampleStorage', fields: ['example_images_path', 'auto_download_example_images', 'optimize_example_images'] },
      { id: 'example-open', title: 'setCard.exampleOpen', fields: ['example_images_open_mode', 'example_images_local_root', 'example_images_open_uri_template'] },
      { id: 'example-download', title: 'setCard.exampleDownload', description: 'setCard.exampleDownload.desc', fields: [], panels: ['exampleImagesDownload'], keywords: 'download all pause resume stop progress' },
    ],
  },
  {
    id: 'metadata',
    title: 'setTab.metadata',
    description: 'setTab.metadata.desc',
    icon: 'book',
    cards: [
      { id: 'civitai', title: 'setCard.civitai', description: 'setCard.civitai.desc', fields: ['civitai_api_key', 'huggingface_api_key', 'civitai_host'] },
      {
        id: 'metadata-sources',
        title: 'setCard.metadataSources',
        fields: ['enable_civarchive_api', 'enable_openmodeldb_api', 'enable_metadata_archive_db', 'metadata_provider_order', 'metadata_refresh_skip_paths'],
      },
      { id: 'metadata-archive', title: 'archive.title', description: 'archive.hint', fields: [], panels: ['metadataArchive'], keywords: 'archive database sqlite download remove' },
      {
        id: 'model-updates',
        title: 'setCard.modelUpdates',
        fields: ['version_grouping', 'hide_early_access_updates', 'hide_paid_updates', 'price_tracking_enabled', 'price_check_ttl_hours'],
      },
    ],
  },
  {
    id: 'integrations',
    title: 'setTab.integrations',
    description: 'setTab.integrations.desc',
    icon: 'link',
    cards: [
      { id: 'ai', title: 'set.section.ai', description: 'set.section.ai.desc', fields: ['llm_provider', 'llm_api_base', 'llm_api_key', 'llm_model'] },
      {
        id: 'proxy',
        title: 'set.section.proxy',
        description: 'set.section.proxy.desc',
        fields: ['proxy_enabled', 'proxy_type', 'proxy_host', 'proxy_port', 'proxy_username', 'proxy_password'],
      },
    ],
  },
  {
    id: 'maintenance',
    title: 'setTab.maintenance',
    description: 'setTab.maintenance.desc',
    icon: 'archive',
    cards: [
      {
        id: 'backups',
        title: 'set.section.backups',
        description: 'set.section.backups.desc',
        fields: ['backup_auto_enabled', 'backup_retention_count'],
        panels: ['backups'],
        keywords: 'backup restore export snapshot zip',
      },
      { id: 'diagnostics', title: 'setCard.diagnostics', description: 'setCard.diagnostics.desc', fields: [], panels: ['diagnostics'], keywords: 'doctor diagnostics statistics stats classic' },
    ],
  },
  {
    id: 'about',
    title: 'setTab.about',
    description: 'setTab.about.desc',
    icon: 'sparkle',
    cards: [{ id: 'about', title: 'setCard.about', fields: [], panels: ['about'], keywords: 'version update changelog environment' }],
  },
]

export const DEFAULT_SETTINGS_TAB = 'general'
export const SETTINGS_TAB_STORAGE_KEY = 'lm-ui.settings.tab'
