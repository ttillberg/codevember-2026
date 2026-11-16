import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Root build script sets CODEVEMBER_BASE to /codevember-2026/NN/.
// Standalone dev/build uses '/'.
// HTTPS=1 serves dev over https with a self-signed cert: AudioWorklet needs a
// secure context, so a phone on the LAN gets no sound over plain http. That server
// never reloads by itself: a reload mid-play leaves a phone's audio hung, so it
// takes the new code only when you reload it yourself.
export default defineConfig({
  base: process.env.CODEVEMBER_BASE ?? '/',
  build: { target: 'esnext' },
  plugins: process.env.HTTPS ? [basicSsl()] : [],
  server: process.env.HTTPS ? { hmr: false } : {},
});
