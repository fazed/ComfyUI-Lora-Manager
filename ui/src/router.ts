import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { basePaths } from '@/utils/basePath'
import type { MessageKey } from '@/i18n'

declare module 'vue-router' {
  interface RouteMeta {
    title?: MessageKey
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/loras' },
  {
    path: '/loras',
    name: 'loras',
    component: () => import('@/pages/LibraryPage.vue'),
    props: { prefix: 'loras' },
    meta: { title: 'nav.loras' },
  },
  {
    path: '/checkpoints',
    name: 'checkpoints',
    component: () => import('@/pages/LibraryPage.vue'),
    props: { prefix: 'checkpoints' },
    meta: { title: 'nav.checkpoints' },
  },
  {
    path: '/embeddings',
    name: 'embeddings',
    component: () => import('@/pages/LibraryPage.vue'),
    props: { prefix: 'embeddings' },
    meta: { title: 'nav.embeddings' },
  },
  {
    path: '/recipes',
    name: 'recipes',
    component: () => import('@/pages/RecipesPage.vue'),
    meta: { title: 'nav.recipes' },
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('@/pages/SearchPage.vue'),
    meta: { title: 'search.title' },
  },
  {
    path: '/downloads',
    name: 'downloads',
    component: () => import('@/pages/DownloadsPage.vue'),
    meta: { title: 'nav.downloads' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/pages/SettingsPage.vue'),
    meta: { title: 'nav.settings' },
  },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/pages/NotFoundPage.vue') },
]

export function createAppRouter() {
  return createRouter({
    history: createWebHistory(basePaths().appPath),
    routes,
  })
}
