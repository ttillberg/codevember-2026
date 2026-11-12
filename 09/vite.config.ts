import { defineConfig } from 'vite';

// Root build script sets CODEVEMBER_BASE to /codevember-2026/NN/.
// Standalone dev/build uses '/'.
export default defineConfig({
  base: process.env.CODEVEMBER_BASE ?? '/',
  build: { target: 'esnext' },
});
