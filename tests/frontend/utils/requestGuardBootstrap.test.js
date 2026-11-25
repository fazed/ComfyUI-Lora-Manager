import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const extractScript = (file) => {
    const html = readFileSync(resolve(repoRoot, file), 'utf8');
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!match) {
        throw new Error(`<script> block not found in ${file}`);
    }
    return match[1];
};

const headerOf = (call) => {
    const [input, init] = call;
    if (init && init.headers !== undefined) {
        return new Headers(init.headers).get('X-LM-Client');
    }
    if (input instanceof Request) {
        return input.headers.get('X-LM-Client');
    }
    return null;
};

describe('request_guard_bootstrap.html', () => {
    let savedFetch;
    let fetchMock;

    beforeEach(() => {
        savedFetch = window.fetch;
        fetchMock = vi.fn(async () => new Response('{}'));
        window.fetch = fetchMock;
        window.history.replaceState({}, '', '/loras');
        (0, eval)(extractScript('templates/components/request_guard_bootstrap.html'));
    });

    afterEach(() => {
        window.fetch = savedFetch;
        window.history.replaceState({}, '', '/');
    });

    it('adds X-LM-Client: lm-classic to relative API requests', async () => {
        await window.fetch('/api/lm/downloads/queue/add?model_id=1');
        expect(headerOf(fetchMock.mock.calls[0])).toBe('lm-classic');
    });

    it('keeps the caller headers and options', async () => {
        await window.fetch('/api/lm/loras/save-metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        const [, init] = fetchMock.mock.calls[0];
        const headers = new Headers(init.headers);
        expect(init.method).toBe('POST');
        expect(init.body).toBe('{}');
        expect(headers.get('Content-Type')).toBe('application/json');
        expect(headers.get('X-LM-Client')).toBe('lm-classic');
    });

    it('handles absolute same-origin URLs, URL objects and Request objects', async () => {
        await window.fetch(`${window.location.origin}/api/lm/loras/scan`);
        await window.fetch(new URL('/api/lm/recipes/scan', window.location.origin));
        await window.fetch(new Request(`${window.location.origin}/api/lm/downloads/queue`, {
            headers: { Accept: 'application/json' },
        }));
        for (const call of fetchMock.mock.calls) {
            expect(headerOf(call)).toBe('lm-classic');
        }
        const [, init] = fetchMock.mock.calls[2];
        expect(new Headers(init.headers).get('Accept')).toBe('application/json');
    });

    it('does not override an explicit client id', async () => {
        await window.fetch('/api/lm/settings', { headers: { 'X-LM-Client': 'custom' } });
        expect(headerOf(fetchMock.mock.calls[0])).toBe('custom');
    });

    it('leaves cross-origin requests untouched (no CORS preflight)', async () => {
        await window.fetch('https://civitai.com/api/v1/models/1');
        const [, init] = fetchMock.mock.calls[0];
        expect(init).toBeUndefined();
    });

    it('installs only once', () => {
        const patched = window.fetch;
        (0, eval)(extractScript('templates/components/request_guard_bootstrap.html'));
        expect(window.fetch).toBe(patched);
    });

    it('is included in base.html right after the base-path bootstrap', () => {
        const base = readFileSync(resolve(repoRoot, 'templates/base.html'), 'utf8');
        const basePath = base.indexOf("components/base_path_bootstrap.html");
        const guard = base.indexOf("components/request_guard_bootstrap.html");
        expect(basePath).toBeGreaterThan(-1);
        expect(guard).toBeGreaterThan(basePath);
        expect(guard).toBeLessThan(base.indexOf('<title>'));
    });
});
