import { defineConfig } from 'vite'
import { resolve } from 'path'
import * as url from 'url'
import tailwindcss from '@tailwindcss/vite'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app.html'),
      },
    },
  },
})
