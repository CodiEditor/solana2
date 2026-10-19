import { defineConfig, type Plugin } from 'vite'

// Social crawlers need absolute URLs for the share image. Vercel exposes the production domain
// at build time. SITE_URL overrides it. With neither, the url and image tags are left out.
function siteMeta(): Plugin {
  return {
    name: 'site-meta',
    transformIndexHtml(html) {
      const host = process.env.SITE_URL
        || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
      const site = host.replace(/\/$/, '')
      if (!site) return html.replace(/^.*(%SITE_URL%|og:image:).*\n/gm, '')
      return html.replace(/%SITE_URL%/g, site)
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [siteMeta()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
