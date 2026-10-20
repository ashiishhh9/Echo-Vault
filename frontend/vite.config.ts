import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API client uses same-origin /api/v1 by default. Forward those requests
// during local development so authenticated API and media calls reach Node.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/v1': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:4173',
        changeOrigin: true,
      },
    },
  },
});
