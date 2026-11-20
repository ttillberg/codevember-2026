import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Root build script sets CODEVEMBER_BASE to /codevember-2026/NN/.
// Standalone dev/build uses '/'.
// Dev runs on http://localhost:51NN, NN this folder, and on the LAN. HTTPS=1 for https with a self-signed cert;
// a day that needs a secure context on a phone (WebGPU, AudioWorklet, the gyroscope) makes that its default here.
const https = !!process.env.HTTPS;
const day = Number(basename(dirname(fileURLToPath(import.meta.url))));

export default defineConfig({
  base: process.env.CODEVEMBER_BASE ?? '/',
  plugins: https ? [basicSsl()] : [],
  build: { target: 'esnext' },
  server: { host: true, port: day ? 5100 + day : 5173, strictPort: true },
});
