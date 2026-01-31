import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    host: true,           // Listens on all network interfaces
    allowedHosts: 'all',  // Best for ngrok/external tunnels
    proxy: {
      // 1. WebSocket / Progress Updates
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        ws: true,
        changeOrigin: true,
        secure: false,
      },
      // 2. REST API calls (Increased timeout for heavy Gemini/FFmpeg tasks)
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        timeout: 600000, // 10 minutes patience for long video tasks
      },
      // 3. Static Media Serving (FIX: Added rewrite to ensure path consistency)
      '/outputs': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/outputs/, '/outputs'),
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/uploads/, '/uploads'),
      }
    },
  },
});