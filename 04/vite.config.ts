import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Root build script sets CODEVEMBER_BASE to /codevember-2026/NN/.
// Standalone dev/build uses '/'.
// HTTPS=1 serves dev over https with a self-signed cert: WebGPU needs a secure context, so a phone on the LAN
// gets the plain light trails over http and the long exposure only over https.
export default defineConfig({
  base: process.env.CODEVEMBER_BASE ?? '/',
  plugins: process.env.HTTPS ? [react(), basicSsl()] : [react()],
  build: { target: 'esnext' },
});
