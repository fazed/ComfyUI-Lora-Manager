import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import LazyMedia from '@/components/LazyMedia.vue'
import { CACHE_HIT_MS, initialMediaState, loadEventType, mediaReducer, type MediaState } from '@/utils/mediaLoad'

describe('mediaReducer', () => {
  const start = (src = 'a.png', state: MediaState = initialMediaState) => mediaReducer(state, { type: 'start', src })

  it('loading -> loaded fades in', () => {
    const loading = start()
    expect(loading.status).toBe('loading')
    const loaded = mediaReducer(loading, { type: 'load', token: loading.token })
    expect(loaded).toMatchObject({ status: 'loaded', instant: false })
  })

  it('loading -> error, and retry goes back to loading', () => {
    const loading = start()
    const failed = mediaReducer(loading, { type: 'error', token: loading.token })
    expect(failed.status).toBe('error')
    const again = mediaReducer(failed, { type: 'retry', src: 'a.png' })
    expect(again.status).toBe('loading')
    expect(again.token).toBeGreaterThan(failed.token)
  })

  it('a cached (already complete) image is shown instantly', () => {
    const loading = start()
    expect(mediaReducer(loading, { type: 'cached', token: loading.token })).toMatchObject({ status: 'loaded', instant: true })
  })

  it('a src change resets and ignores late events of the previous src', () => {
    const first = start('a.png')
    const loaded = mediaReducer(first, { type: 'load', token: first.token })
    const second = start('b.png', loaded)
    expect(second).toMatchObject({ status: 'loading', instant: false })
    expect(mediaReducer(second, { type: 'load', token: first.token })).toBe(second)
    expect(mediaReducer(second, { type: 'error', token: first.token })).toBe(second)
  })

  it('no src is the empty state', () => {
    expect(start('').status).toBe('empty')
  })

  it('treats a near-instant load as a cache hit (lazy image scrolled back into view)', () => {
    expect(loadEventType(5)).toBe('cached')
    expect(loadEventType(CACHE_HIT_MS + 1)).toBe('load')
  })
})

describe('LazyMedia', () => {
  afterEach(() => vi.restoreAllMocks())

  /** Network-speed load: the load event arrives well after the element was shown. */
  function slowClock(): void {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 1000))
  }

  const img = (wrapper: ReturnType<typeof mount>) => wrapper.find('img')
  const placeholder = (wrapper: ReturnType<typeof mount>) => wrapper.find('.lm-media-placeholder')

  it('shows a placeholder while loading, then fades the image in', async () => {
    slowClock()
    const wrapper = mount(LazyMedia, { props: { src: '/a.png', mediaClass: 'size-full object-cover' } })
    await nextTick()
    expect(placeholder(wrapper).classes()).toContain('is-loading')
    expect(img(wrapper).classes()).toEqual(expect.arrayContaining(['lm-fade', 'size-full', 'object-cover']))
    expect(img(wrapper).classes()).not.toContain('is-loaded')
    expect(img(wrapper).attributes('loading')).toBe('lazy')
    expect(img(wrapper).attributes('decoding')).toBe('async')
    await img(wrapper).trigger('load')
    await flushPromises()
    expect(img(wrapper).classes()).toContain('is-loaded')
    expect(img(wrapper).classes()).not.toContain('is-instant')
    expect(placeholder(wrapper).classes()).not.toContain('is-loading')
  })

  it('shows an already complete (cached) image at once, without a fade', async () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(100)
    const wrapper = mount(LazyMedia, { props: { src: '/cached.png' } })
    await flushPromises()
    expect(img(wrapper).classes()).toEqual(expect.arrayContaining(['is-loaded', 'is-instant']))
    expect(wrapper.find('.lm-media-placeholder').exists()).toBe(false)
  })

  it('shows the fallback on error and retries on click when enabled', async () => {
    const wrapper = mount(LazyMedia, { props: { src: '/broken.png', retry: true } })
    await nextTick()
    await img(wrapper).trigger('error')
    expect(img(wrapper).exists()).toBe(false)
    const retry = wrapper.find('button')
    expect(retry.exists()).toBe(true)
    await retry.trigger('click')
    await nextTick()
    expect(img(wrapper).exists()).toBe(true)
    expect(placeholder(wrapper).classes()).toContain('is-loading')
  })

  it('renders the fallback slot without a src', async () => {
    const wrapper = mount(LazyMedia, { props: { src: '' }, slots: { fallback: '<span class="no-preview">none</span>' } })
    await nextTick()
    expect(wrapper.find('.no-preview').exists()).toBe(true)
    expect(img(wrapper).exists()).toBe(false)
  })

  it('resets to loading when the src changes (recycled card)', async () => {
    const wrapper = mount(LazyMedia, { props: { src: '/a.png' } })
    await nextTick()
    await img(wrapper).trigger('load')
    await flushPromises()
    expect(img(wrapper).classes()).toContain('is-loaded')
    // Typed loosely: setProps' inferred type for SFC props is narrower than the runtime API.
    await wrapper.setProps({ src: '/b.png' } as never)
    await nextTick()
    expect(img(wrapper).attributes('src')).toBe('/b.png')
    expect(img(wrapper).classes()).not.toContain('is-loaded')
    expect(placeholder(wrapper).classes()).toContain('is-loading')
  })

  it('renders videos with the requested attributes', async () => {
    slowClock()
    const wrapper = mount(LazyMedia, { props: { src: '/clip.mp4', loop: true, autoplay: true } })
    await nextTick()
    const video = wrapper.find('video')
    expect(video.exists()).toBe(true)
    expect((video.element as HTMLVideoElement).loop).toBe(true)
    expect((video.element as HTMLVideoElement).muted).toBe(true)
    await video.trigger('loadeddata')
    expect(video.classes()).toContain('is-loaded')
  })

  it('shows a quick (cached) load without a fade', async () => {
    const wrapper = mount(LazyMedia, { props: { src: '/quick.png' } })
    await nextTick()
    await img(wrapper).trigger('load')
    await flushPromises()
    expect(img(wrapper).classes()).toEqual(expect.arrayContaining(['is-loaded', 'is-instant']))
  })

  it('passes eager loading and fetchpriority through (drawer cover)', async () => {
    const wrapper = mount(LazyMedia, { props: { src: '/cover.png', loading: 'eager', fetchpriority: 'high' } })
    await nextTick()
    expect(img(wrapper).attributes('loading')).toBe('eager')
    expect(img(wrapper).attributes('fetchpriority')).toBe('high')
  })
})
