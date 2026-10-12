import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  base: './',
  server: {
    proxy: {
      '/api': {
        target: 'https://solana2-production.up.railway.app',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: mode === 'mainnet' ? 'dist-mainnet' : mode === 'testnet' ? 'dist-testnet' : 'dist',
    sourcemap: false,
  },
  define: {
    __APP_MODE__: JSON.stringify(mode),
  },
}))

