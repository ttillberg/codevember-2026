import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Root build script sets CODEVEMBER_BASE to /codevember-2026/NN/.
// Standalone dev/build uses '/'.
// HTTPS=1 serves dev over https with a self-signed cert: a phone only hands out its gyroscope to a secure
// context, so tilting to look around needs it on the LAN.
export default defineConfig({
  base: process.env.CODEVEMBER_BASE ?? '/',
  build: { target: 'esnext' },
  plugins: process.env.HTTPS ? [basicSsl()] : [],
  // dev on the local network too: open the Network url Vite prints on a phone on the same wifi
  // ngrok for showing it from afar: Vite turns away host names it does not know
  server: { host: true, allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io'] },
});
