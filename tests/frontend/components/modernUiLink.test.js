import { afterEach, describe, expect, it, vi } from 'vitest';

const { API_MODULE, APP_MODULE } = vi.hoisted(() => ({
  API_MODULE: new URL('../../../scripts/api.js', import.meta.url).pathname,
  APP_MODULE: new URL('../../../scripts/app.js', import.meta.url).pathname,
}));
vi.mock(API_MODULE, () => ({ api: { fetchApi: vi.fn() } }));
vi.mock(APP_MODULE, () => ({
  app: { registerExtension: vi.fn(), graph: {}, ui: { settings: { settingsById: {} } } },
}));

import {
  CLASSIC_UI_PATH,
  MODERN_UI_PATH,
  managerHomePath,
  modelDeepLinkPath,
  modernUiAvailability,
  probeModernUi,
  recipeDeepLinkPath,
  resetModernUiProbe,
} from '../../../web/comfyui/modern_ui_link.js';
import { openLoraManager, openLoraManagerHome } from '../../../web/comfyui/lora_canvas_api.js';
import { openRecipeManager } from '../../../web/comfyui/recipe_canvas_api.js';

/** Decode the `?open=` value the way the modern UI router reads it. */
const openParam = (path) => new URL(path, 'http://host').searchParams.get('open');
/** Decode the classic `#model=` / `#recipe=` hash value. */
const hashParam = (path, key) => new URLSearchParams(new URL(path, 'http://host').hash.slice(1)).get(key);

const TRICKY_PATH = 'C:\\Models\\loras\\my style #2 & co?\\日本語 lora.safetensors';

afterEach(() => {
  resetModernUiProbe();
  vi.restoreAllMocks();
});

describe('managerHomePath', () => {
  it('uses the modern UI only when the probe confirmed it', () => {
    expect(managerHomePath(true)).toBe(MODERN_UI_PATH);
    expect(managerHomePath(false)).toBe(CLASSIC_UI_PATH);
    expect(managerHomePath(null)).toBe(CLASSIC_UI_PATH);
  });
});

describe('probeModernUi', () => {
  it('probes /lm-ui/ once with HEAD and caches the answer', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });

    expect(modernUiAvailability()).toBeNull();
    await expect(probeModernUi(fetchFn)).resolves.toBe(true);
    await probeModernUi(fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/lm-ui/', { method: 'HEAD', cache: 'no-store' });
    expect(modernUiAvailability()).toBe(true);
  });

  it('treats an unbuilt UI (503) as unavailable', async () => {
    await expect(probeModernUi(vi.fn().mockResolvedValue({ ok: false, status: 503 }))).resolves.toBe(false);
    expect(modernUiAvailability()).toBe(false);
  });

  it('treats a network error or a throwing fetch as unavailable', async () => {
    await expect(probeModernUi(vi.fn().mockRejectedValue(new Error('offline')))).resolves.toBe(false);
    resetModernUiProbe();
    await expect(
      probeModernUi(() => {
        throw new Error('no fetch');
      }),
    ).resolves.toBe(false);
  });
});

describe('openLoraManagerHome', () => {
  it('opens the modern UI once the probe found it', async () => {
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);
    await probeModernUi(vi.fn().mockResolvedValue({ ok: true }));

    openLoraManagerHome();
    openLoraManagerHome(true);

    expect(openMock).toHaveBeenNthCalledWith(1, `${window.location.origin}/lm-ui/`, '_blank');
    expect(openMock).toHaveBeenNthCalledWith(
      2,
      `${window.location.origin}/lm-ui/`,
      '_blank',
      'width=1200,height=800,resizable=yes,scrollbars=yes,status=yes',
    );
  });

  it('falls back to the classic UI when the modern UI is not served', async () => {
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);
    await probeModernUi(vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    openLoraManagerHome();

    expect(openMock).toHaveBeenCalledWith(`${window.location.origin}/loras`, '_blank');
  });

  it('falls back to the classic UI while the probe has not answered', () => {
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);
    probeModernUi(() => new Promise(() => {}));

    openLoraManagerHome();

    expect(openMock).toHaveBeenCalledWith(`${window.location.origin}/loras`, '_blank');
  });
});

describe('modelDeepLinkPath', () => {
  it('links to the modern library route with ?open=<file_path> once the probe confirmed it', () => {
    const path = 'G:/ComfyUI/models/loras/Anima/style/Anima 2.5D.safetensors';
    const link = modelDeepLinkPath(path, true);

    expect(link).toBe('/lm-ui/loras?open=G%3A%2FComfyUI%2Fmodels%2Floras%2FAnima%2Fstyle%2FAnima%202.5D.safetensors');
    expect(openParam(link)).toBe(path);
  });

  it('uses the route of the model type', () => {
    expect(modelDeepLinkPath('/m/a.safetensors', true, 'checkpoints')).toBe('/lm-ui/checkpoints?open=%2Fm%2Fa.safetensors');
    expect(modelDeepLinkPath('/m/a.pt', true, 'embeddings')).toBe('/lm-ui/embeddings?open=%2Fm%2Fa.pt');
    expect(modelDeepLinkPath('/m/a.pt', false, 'embeddings')).toBe('/embeddings#model=%2Fm%2Fa.pt');
    expect(modelDeepLinkPath('/m/a.pt', true, 'unknown')).toBe('/lm-ui/loras?open=%2Fm%2Fa.pt');
  });

  it('sends forward slashes (the library cache format) and encodes spaces, unicode, #, & and ?', () => {
    const link = modelDeepLinkPath(TRICKY_PATH, true);

    expect(link.startsWith('/lm-ui/loras?open=')).toBe(true);
    expect(link.split('?')).toHaveLength(2);
    expect(link).not.toContain('#');
    expect(link).not.toContain('&');
    expect(link).not.toContain(' ');
    expect(openParam(link)).toBe('C:/Models/loras/my style #2 & co?/日本語 lora.safetensors');
  });

  it('keeps the classic #model=<path> link while the probe is pending or failed', () => {
    for (const availability of [null, false]) {
      const link = modelDeepLinkPath(TRICKY_PATH, availability);
      expect(link.startsWith('/loras#model=')).toBe(true);
      expect(hashParam(link, 'model')).toBe(TRICKY_PATH);
    }
  });

  it('opens the bare library route without a path', () => {
    expect(modelDeepLinkPath('', true)).toBe('/lm-ui/loras');
    expect(modelDeepLinkPath('', null)).toBe('/loras');
    expect(modelDeepLinkPath(undefined, false)).toBe('/loras');
  });
});

describe('recipeDeepLinkPath', () => {
  it('links to the modern recipes route with ?open=<id> once the probe confirmed it', () => {
    expect(recipeDeepLinkPath('3f2a-uuid', true)).toBe('/lm-ui/recipes?open=3f2a-uuid');
    const link = recipeDeepLinkPath('a/b #1&x?', true);
    expect(openParam(link)).toBe('a/b #1&x?');
    expect(link).not.toContain('#');
  });

  it('keeps the classic #recipe=<id> link while the probe is pending or failed', () => {
    expect(recipeDeepLinkPath('recipe/2', null)).toBe('/loras/recipes#recipe=recipe%2F2');
    expect(recipeDeepLinkPath('recipe/2', false)).toBe('/loras/recipes#recipe=recipe%2F2');
  });

  it('opens the bare recipes route without an id', () => {
    expect(recipeDeepLinkPath('', true)).toBe('/lm-ui/recipes');
    expect(recipeDeepLinkPath('', null)).toBe('/loras/recipes');
  });
});

describe('openLoraManager / openRecipeManager', () => {
  it('open the modern deep links synchronously in the named manager tab', async () => {
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);
    await probeModernUi(vi.fn().mockResolvedValue({ ok: true }));

    openLoraManager('G:/models/loras/a b.safetensors');
    openRecipeManager('r-1');
    openLoraManager('', true);

    expect(openMock).toHaveBeenNthCalledWith(
      1,
      `${window.location.origin}/lm-ui/loras?open=G%3A%2Fmodels%2Floras%2Fa%20b.safetensors`,
      'lm-lora-manager',
    );
    expect(openMock).toHaveBeenNthCalledWith(2, `${window.location.origin}/lm-ui/recipes?open=r-1`, 'lm-lora-manager');
    expect(openMock).toHaveBeenNthCalledWith(
      3,
      `${window.location.origin}/lm-ui/loras`,
      '_blank',
      'width=1200,height=800,resizable=yes,scrollbars=yes,status=yes',
    );
  });

  it('fall back to the classic deep links when the modern UI is not served', async () => {
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);
    await probeModernUi(vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    openLoraManager('/models/astral.safetensors');
    openRecipeManager('r-1');

    expect(openMock).toHaveBeenNthCalledWith(
      1,
      `${window.location.origin}/loras#model=%2Fmodels%2Fastral.safetensors`,
      'lm-lora-manager',
    );
    expect(openMock).toHaveBeenNthCalledWith(2, `${window.location.origin}/loras/recipes#recipe=r-1`, 'lm-lora-manager');
  });

  it('fall back to the classic deep links while the probe has not answered', () => {
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);
    probeModernUi(() => new Promise(() => {}));

    openLoraManager('/models/astral.safetensors');
    openRecipeManager('');

    expect(openMock).toHaveBeenNthCalledWith(
      1,
      `${window.location.origin}/loras#model=%2Fmodels%2Fastral.safetensors`,
      'lm-lora-manager',
    );
    expect(openMock).toHaveBeenNthCalledWith(2, `${window.location.origin}/loras/recipes`, 'lm-lora-manager');
  });
});
