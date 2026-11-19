import { defineConfig } from 'vite';

// Root build script sets CODEVEMBER_BASE to /codevember-2026/NN/.
// Standalone dev/build uses '/'.
// A second piece on day 04, next to the city in 04/: dev on http://localhost:5140 (51NN is taken by 04), and on the LAN.
export default defineConfig({
  base: process.env.CODEVEMBER_BASE ?? '/',
  build: { target: 'esnext' },
  server: { host: true, port: 5140, strictPort: true },
});
