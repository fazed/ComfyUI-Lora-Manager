import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { basePaths } from '@/utils/basePath'
import type { MessageKey } from '@/i18n'

/**
 * Layout kind of a routed page (see ui/README.md "Page layout"):
 * - `content`: centered PageShell container (Downloads, Stats, Settings, ...);
 * - `grid`: full-width library page with its own toolbar and virtualised grid.
 */
export const LAYOUT_KINDS = ['content', 'grid'] as const
export type LayoutKind = (typeof LAYOUT_KINDS)[number]

declare module 'vue-router' {
  interface RouteMeta {
    title?: MessageKey
    layout?: LayoutKind
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/loras' },
  {
    path: '/loras',
    name: 'loras',
    component: () => import('@/pages/LibraryPage.vue'),
    props: { prefix: 'loras' },
    meta: { title: 'nav.loras', layout: 'grid' },
  },
  {
    path: '/checkpoints',
    name: 'checkpoints',
    component: () => import('@/pages/LibraryPage.vue'),
    props: { prefix: 'checkpoints' },
    meta: { title: 'nav.checkpoints', layout: 'grid' },
  },
  {
    path: '/embeddings',
    name: 'embeddings',
    component: () => import('@/pages/LibraryPage.vue'),
    props: { prefix: 'embeddings' },
    meta: { title: 'nav.embeddings', layout: 'grid' },
  },
  {
    path: '/recipes',
    name: 'recipes',
    component: () => import('@/pages/RecipesPage.vue'),
    meta: { title: 'nav.recipes', layout: 'grid' },
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('@/pages/SearchPage.vue'),
    meta: { title: 'search.title', layout: 'content' },
  },
  {
    path: '/downloads',
    name: 'downloads',
    component: () => import('@/pages/DownloadsPage.vue'),
    meta: { title: 'nav.downloads', layout: 'content' },
  },
  {
    path: '/settings/:tab?',
    name: 'settings',
    component: () => import('@/pages/SettingsPage.vue'),
    meta: { title: 'nav.settings', layout: 'content' },
  },
  {
    path: '/stats',
    name: 'stats',
    component: () => import('@/pages/StatsPage.vue'),
    meta: { title: 'nav.stats', layout: 'content' },
  },
  {
    path: '/doctor',
    name: 'doctor',
    component: () => import('@/pages/DoctorPage.vue'),
    meta: { title: 'nav.doctor', layout: 'content' },
  },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/pages/NotFoundPage.vue'), meta: { layout: 'content' } },
]

export function createAppRouter() {
  return createRouter({
    history: createWebHistory(basePaths().appPath),
    routes,
  })
}
