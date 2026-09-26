import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development Vite serves the SPA and forwards /api to the Fastify API.
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // zod ships /*#__PURE__*/ comments in positions Rollup ignores; harmless noise.
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('node_modules')) return;
        warn(warning);
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: apiOrigin },
    },
  },
});
