/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During dev, proxy API calls to the backend so cookies + same-origin work.
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind 0.0.0.0 so the dev server is reachable when running in a container.
    host: true,
    port: Number(process.env.VITE_PORT) || 5173,
    proxy: {
      '/api': {
        // In docker-compose.dev.yml this points at the backend service; on the
        // host it defaults to localhost:8080.
        target: process.env.VITE_API_TARGET || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    // jsdom, so component behaviour (effects, timers, re-render) is testable —
    // that's where the bugs worth catching here live.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
});
