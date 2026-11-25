import { describe, it, expect, vi } from 'vitest';

// matchLibraryRoot is a pure helper; the module's other imports are mocked so
// importing it has no side effects.
const {
  MODEL_VERSIONS_MODULE,
  API_FACTORY_MODULE,
  DOWNLOAD_MANAGER_MODULE,
  UI_HELPERS_MODULE,
  STATE_MODULE,
  I18N_HELPERS_MODULE,
  UTILS_MODULE,
} = vi.hoisted(() => ({
  MODEL_VERSIONS_MODULE: new URL('../../../static/js/components/shared/ModelVersionsTab.js', import.meta.url).pathname,
  API_FACTORY_MODULE: new URL('../../../static/js/api/modelApiFactory.js', import.meta.url).pathname,
  DOWNLOAD_MANAGER_MODULE: new URL('../../../static/js/managers/DownloadManager.js', import.meta.url).pathname,
  UI_HELPERS_MODULE: new URL('../../../static/js/utils/uiHelpers.js', import.meta.url).pathname,
  STATE_MODULE: new URL('../../../static/js/state/index.js', import.meta.url).pathname,
  I18N_HELPERS_MODULE: new URL('../../../static/js/utils/i18nHelpers.js', import.meta.url).pathname,
  UTILS_MODULE: new URL('../../../static/js/components/shared/utils.js', import.meta.url).pathname,
}));

vi.mock(DOWNLOAD_MANAGER_MODULE, () => ({ downloadManager: {} }));
vi.mock(UI_HELPERS_MODULE, () => ({ showToast: vi.fn(), openCivitaiUrl: vi.fn() }));
vi.mock(STATE_MODULE, () => ({ state: { global: { settings: {} } } }));
vi.mock(I18N_HELPERS_MODULE, () => ({ translate: vi.fn((_, __, fallback) => fallback ?? '') }));
vi.mock(UTILS_MODULE, () => ({ formatFileSize: vi.fn(() => '1 MB') }));
vi.mock(API_FACTORY_MODULE, () => ({ getModelApiClient: vi.fn() }));

const { matchLibraryRoot } = await import(MODEL_VERSIONS_MODULE);

describe('matchLibraryRoot', () => {
  it('matches a POSIX root and returns the path below it', () => {
    expect(matchLibraryRoot('/models/loras/a/b.safetensors', ['/models/loras'])).toEqual({
      root: '/models/loras',
      relativePath: 'a/b.safetensors',
    });
  });

  it('folds Windows separators and ignores a trailing separator on the root', () => {
    expect(matchLibraryRoot('D:\\Models\\Loras\\x\\y.safetensors', ['D:\\Models\\Loras\\'])).toEqual({
      root: 'D:\\Models\\Loras\\',
      relativePath: 'x/y.safetensors',
    });
  });

  it('is case-insensitive for Windows paths', () => {
    expect(matchLibraryRoot('d:/models/loras/x.safetensors', ['D:/Models/Loras'])).toEqual({
      root: 'D:/Models/Loras',
      relativePath: 'x.safetensors',
    });
  });

  it('does not let a root swallow a sibling that shares its prefix', () => {
    expect(matchLibraryRoot('D:/loras_old/x.safetensors', ['D:/loras'])).toBeNull();
    expect(matchLibraryRoot('/models/lorasX/x.safetensors', ['/models/loras'])).toBeNull();
  });

  it('picks the sibling root rather than the prefix root', () => {
    expect(
      matchLibraryRoot('D:/loras_old/x.safetensors', ['D:/loras', 'D:/loras_old']),
    ).toEqual({ root: 'D:/loras_old', relativePath: 'x.safetensors' });
  });

  it('prefers the most specific root and an exact-case match', () => {
    expect(
      matchLibraryRoot('/m/loras/sub/x.safetensors', ['/m', '/m/loras']),
    ).toEqual({ root: '/m/loras', relativePath: 'sub/x.safetensors' });
    expect(
      matchLibraryRoot('/m/Loras/x.safetensors', ['/m/loras', '/m/Loras']),
    ).toEqual({ root: '/m/Loras', relativePath: 'x.safetensors' });
  });

  it('returns null for the root itself, unknown paths and bad input', () => {
    expect(matchLibraryRoot('/models/loras', ['/models/loras'])).toBeNull();
    expect(matchLibraryRoot('/elsewhere/x.safetensors', ['/models/loras'])).toBeNull();
    expect(matchLibraryRoot('', ['/models/loras'])).toBeNull();
    expect(matchLibraryRoot('/models/loras/x', null)).toBeNull();
    expect(matchLibraryRoot('/models/loras/x', ['', null, '/'])).toBeNull();
  });
});
