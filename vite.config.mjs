// vite.config.mjs
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  preview: {
    host: '0.0.0.0',
    port: process.env.PORT || 5173,
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      'hr-recruitment-ow0k.onrender.com'   // 👈 add your Render domain here
    ]
  }
});
