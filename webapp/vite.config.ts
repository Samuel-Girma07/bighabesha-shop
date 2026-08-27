import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Isomorphic web3 libs expect Node globals in the browser.
  define: {
    global: 'globalThis',
    'process.env': {},
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-telegram': ['@telegram-apps/sdk-react'],
          'vendor-ton': ['@tonconnect/ui-react', '@ton/core'],
          'vendor-icons': ['lucide-react'],
          'vendor-three': ['three'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
