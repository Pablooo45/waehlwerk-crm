/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// "npm run build"       → echtes CRM (dist/), liest public/config.js
// "npm run build:demo"  → eine einzige HTML-Datei mit Demo-Daten (dist-demo/)
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  const injectConfig: Plugin = {
    name: 'inject-runtime-config',
    transformIndexHtml(html) {
      if (demo) return html;
      return html.replace('<!-- runtime-config -->', '<script src="./config.js"></script>');
    },
  };
  return {
    base: './',
    plugins: [react(), injectConfig, ...(demo ? [viteSingleFile()] : [])],
    define: {
      __DEMO_BUILD__: JSON.stringify(demo),
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
    },
    build: {
      outDir: demo ? 'dist-demo' : 'dist',
      emptyOutDir: true,
      assetsInlineLimit: demo ? 100_000_000 : 4096,
      chunkSizeWarningLimit: 3000,
      sourcemap: !demo,
    },
    server: { port: 5173, host: true },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  };
});
