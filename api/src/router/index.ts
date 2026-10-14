import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'catalog', component: () => import('@/views/ApiCatalogView.vue') },
    {
      path: '/operations/:operationId',
      name: 'operation',
      component: () => import('@/views/ApiCatalogView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
