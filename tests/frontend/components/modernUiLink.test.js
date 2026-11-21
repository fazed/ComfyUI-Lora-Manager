import { afterEach, describe, expect, it, vi } from 'vitest';

const { API_MODULE } = vi.hoisted(() => ({
  API_MODULE: new URL('../../../scripts/api.js', import.meta.url).pathname,
}));
vi.mock(API_MODULE, () => ({ api: { fetchApi: vi.fn() } }));

import {
  CLASSIC_UI_PATH,
  MODERN_UI_PATH,
  managerHomePath,
  modernUiAvailability,
  probeModernUi,
  resetModernUiProbe,
} from '../../../web/comfyui/modern_ui_link.js';
import { openLoraManagerHome } from '../../../web/comfyui/lora_canvas_api.js';

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
