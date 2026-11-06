import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SERVER_PORT = 5181; // idem
const CLIENT_PORT = 5180; // el mismo que shared/src/index.ts (la config no puede importar .ts del workspace)

// solo en desarrollo: la herramienta de agarres (/?grips) guarda aquí lo que ajusta
// (POST /__grips?file=grips|pieces: agarres de las manos o medidas de los accesorios)
const SAVEABLE: Record<string, string> = { grips: 'grips.json', pieces: 'pieces.json' };
const gripsSaver = (): Plugin => ({
  name: 'grips-saver',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__grips', (req, res) => {
      if (req.method !== 'POST') return (res.statusCode = 405), res.end();
      const file = SAVEABLE[new URL(req.url ?? '', 'http://x').searchParams.get('file') ?? 'grips'];
      if (!file) return (res.statusCode = 400), res.end('unknown file');
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          JSON.parse(body);
          writeFileSync(fileURLToPath(new URL('./src/game/' + file, import.meta.url)), body);
          res.end('ok');
        } catch {
          res.statusCode = 400;
          res.end('bad json');
        }
      });
    });
  },
});

const proxy = {
  '/socket.io': { target: `http://localhost:${SERVER_PORT}`, ws: true },
  '/status': `http://localhost:${SERVER_PORT}`,
  '/api': `http://localhost:${SERVER_PORT}`,
};

// el juego pregunta por process.env.NODE_ENV (avisos y atajos de desarrollo): se define a mano
export default defineConfig(({ mode }) => ({
  plugins: [react(), gripsSaver()],
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development') },
  // the game server goes through the same port as the page (one forwarded port or tunnel is enough, no mixed content over https)
  server: { port: CLIENT_PORT, strictPort: true, host: true, allowedHosts: true, proxy },
  preview: { port: CLIENT_PORT, strictPort: true, host: true, allowedHosts: true, proxy },
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
}));
