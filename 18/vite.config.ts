import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Root build script sets CODEVEMBER_BASE to /codevember-2026/NN/.
// Standalone dev/build uses '/'.
// Dev runs on https://localhost:51NN, NN this folder, and on the LAN: https, since a phone hands out AudioWorklet
// only to a secure context. The cert is self-signed, accept it once. HTTP=1 for plain http.
const https = !process.env.HTTP;
const day = Number(basename(dirname(fileURLToPath(import.meta.url))));

export default defineConfig({
  base: process.env.CODEVEMBER_BASE ?? '/',
  plugins: https ? [basicSsl()] : [],
  build: { target: 'esnext' },
  server: { host: true, port: day ? 5100 + day : 5173, strictPort: true },
});
