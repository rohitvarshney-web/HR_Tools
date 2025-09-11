// vite.config.mjs — ESM config so @vitejs/plugin-react (ESM-only) loads correctly
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
