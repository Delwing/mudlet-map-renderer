import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
    root: 'demo',
    resolve: {
        alias: [
            // Browser shim for qtdatastream (Node-stream based) so the dropped-.dat
            // loader parses maps in the browser. Mirrors vite.config.ts's serve shim.
            {find: /^qtdatastream$/, replacement: path.resolve(__dirname, 'demo/qtdatastream-browser.js')},
            {find: '@src', replacement: path.resolve(__dirname, 'src')},
        ],
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                index: path.resolve(__dirname, 'demo/index.html'),
                '3d': path.resolve(__dirname, 'demo/3d.html')
            }
        }
    }
});
