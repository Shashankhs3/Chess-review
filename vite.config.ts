import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// base './' lets the same build work on GitHub Pages (any repo path), Netlify, Cloudflare Pages, or a plain folder.
export default defineConfig({
  base: './',
  plugins: [react()],
})
