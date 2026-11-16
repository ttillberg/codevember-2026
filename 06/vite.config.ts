import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Root build script sets CODEVEMBER_BASE to /codevember-2026/NN/.
// Standalone dev/build uses '/'.
export default defineConfig({
  base: process.env.CODEVEMBER_BASE ?? '/',
  plugins: [react()],
  build: { target: 'esnext' },
  // dev on the local network too: open the Network url Vite prints on a phone on the same wifi
  server: { host: true },
});
