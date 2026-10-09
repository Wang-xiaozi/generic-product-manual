import { createRouter, createWebHistory } from 'vue-router'

const pages = import.meta.glob('../views/**/*.vue')
const routes = Object.entries(pages).map(([file, component]) => {
  const suffix = file.replace('../views/', '').replace(/\.vue$/, '')
  const path = `/${suffix.replace(/\/index$/, '')}`
  return { path, component }
})

export default createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', redirect: '/product-manual' }, ...routes],
})
