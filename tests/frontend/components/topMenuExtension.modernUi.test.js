import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fork: the native top-menu button (upstream PR #1230) still opens the modern
// UI (/lm-ui/) when it is served and the classic /loras page otherwise.
// setup() starts the HEAD probe; the click goes through the real
// openLoraManagerHome, so this covers the whole path on top of the new button.

const { APP_MODULE, API_MODULE, QUICK_MENU_MODULE, appMock } = vi.hoisted(() => ({
  APP_MODULE: new URL('../../../scripts/app.js', import.meta.url).pathname,
  API_MODULE: new URL('../../../scripts/api.js', import.meta.url).pathname,
  QUICK_MENU_MODULE: new URL('../../../web/comfyui/quick_actions_menu.js', import.meta.url).pathname,
  appMock: { registerExtension: vi.fn(), menu: undefined },
}));

vi.mock(APP_MODULE, () => ({ app: appMock }));
vi.mock(API_MODULE, () => ({ api: { fetchApi: vi.fn() } }));
vi.mock(QUICK_MENU_MODULE, () => ({ toggleQuickActionsMenu: vi.fn() }));

const BUTTON_TOOLTIP = 'Open LoRA Manager (Shift+Click opens in a new window)';

function stubBackend(modernUiServed) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    if (options.method === 'HEAD') {
      return { ok: modernUiServed, status: modernUiServed ? 200 : 503 };
    }
    return { ok: true, json: async () => ({ success: true, version: '9.9.9' }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function loadExtension(version) {
  window.__COMFYUI_FRONTEND_VERSION__ = version;
  vi.resetModules();
  await import('../../../web/comfyui/top_menu_extension.js');
  await vi.waitFor(() => expect(appMock.registerExtension).toHaveBeenCalled());
  return appMock.registerExtension.mock.calls.at(-1)[0];
}

async function setupAndProbe(extension, fetchMock) {
  await extension.setup();
  await vi.waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/lm-ui\/$/),
      expect.objectContaining({ method: 'HEAD' }),
    ),
  );
  // Let the probe promise settle before the click reads it synchronously.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('top menu button and the modern UI link (fork)', () => {
  let openSpy;

  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.__lmIconObserver;
    delete window.__COMFYUI_FRONTEND_VERSION__;
    appMock.registerExtension.mockClear();
    appMock.menu = undefined;
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('opens /lm-ui/ from the native action bar button when it is served', async () => {
    const fetchMock = stubBackend(true);
    const extension = await loadExtension('1.50.0');
    await setupAndProbe(extension, fetchMock);

    const [main] = extension.actionBarButtons;
    expect(main.tooltip).toBe(BUTTON_TOOLTIP);

    main.onClick({ shiftKey: false });
    expect(openSpy).toHaveBeenLastCalledWith(expect.stringMatching(/\/lm-ui\/$/), '_blank');

    main.onClick({ shiftKey: true });
    const [url, target, features] = openSpy.mock.calls.at(-1);
    expect(url).toMatch(/\/lm-ui\/$/);
    expect(target).toBe('_blank');
    expect(features).toContain('width=1200');
  });

  it('falls back to the classic /loras page when /lm-ui/ is not served', async () => {
    const fetchMock = stubBackend(false);
    const extension = await loadExtension('1.50.0');
    await setupAndProbe(extension, fetchMock);

    extension.actionBarButtons[0].onClick({ shiftKey: false });
    expect(openSpy).toHaveBeenLastCalledWith(expect.stringMatching(/\/loras$/), '_blank');
  });

  it('probes and links the modern UI from the legacy menu button too', async () => {
    const fetchMock = stubBackend(true);
    const settingsGroupParent = document.createElement('div');
    const settingsGroup = document.createElement('button');
    settingsGroupParent.appendChild(settingsGroup);
    document.body.appendChild(settingsGroupParent);
    appMock.menu = { settingsGroup: { element: settingsGroup, parentElement: settingsGroupParent } };

    const extension = await loadExtension('1.33.8');
    await setupAndProbe(extension, fetchMock);

    const mainButton = document.querySelector('.lora-manager-top-menu-group button');
    mainButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openSpy).toHaveBeenLastCalledWith(expect.stringMatching(/\/lm-ui\/$/), '_blank');
  });
});
