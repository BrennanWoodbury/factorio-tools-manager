import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During dev, proxy API calls to the backend so cookies + same-origin work.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
