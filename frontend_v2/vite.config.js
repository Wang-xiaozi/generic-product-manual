import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [vue()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: env.VITE_WEB_HOST,
      port: Number(env.VITE_WEB_PORT),
      proxy: { '/api': env.VITE_API_PROXY_TARGET },
      fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    },
    build: { outDir: 'dist', emptyOutDir: true },
  }
})
