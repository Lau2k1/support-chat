import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        widget: path.resolve(__dirname, 'widget.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/login': 'http://localhost:3000',
      '/register': 'http://localhost:3000',
      '/chats': 'http://localhost:3000',
      '/messages': 'http://localhost:3000',
      '/chat-status': 'http://localhost:3000',
      '/upload': 'http://localhost:3000',
      '/rate': 'http://localhost:3000',
      '/stats': 'http://localhost:3000',
      '/canned-responses': 'http://localhost:3000',
      '/admin/operators': 'http://localhost:3000',
      '/admin/invite-codes': 'http://localhost:3000',
      '/admin/operator-stats': 'http://localhost:3000',
      '/admin/chats': 'http://localhost:3000',
      '/admin/tags': 'http://localhost:3000',
      '/admin/settings': 'http://localhost:3000',
      '/': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
