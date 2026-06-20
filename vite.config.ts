import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import path from 'path';

export default defineConfig(({ command }) => ({
    root: command === 'serve' ? 'demo' : '.',
    resolve: {
        alias: [
            // Demo only: redirect qtdatastream's bare entry (which pulls in
            // Node-stream-based socket/transform) to a browser-safe shim so the
            // dropped-.dat loader can parse maps in the browser. Exact-match the
            // bare specifier; `qtdatastream/src/*` subpaths pass through.
            ...(command === 'serve'
                ? [{find: /^qtdatastream$/, replacement: path.resolve(__dirname, 'demo/qtdatastream-browser.js')}]
                : []),
            {find: '@src', replacement: path.resolve(__dirname, 'src')},
        ],
    },
    plugins: [
        dts({
            include: ['src'],
            outDir: 'dist'
        })
    ],
    build: {
        lib: {
            entry: {
                index: 'src/index.ts',
                binary: 'src/binary/index.ts',
                offscreen: 'src/rendering/offscreen/index.ts',
            },
            name: 'mudlet-map-renderer',
            // index → dist/index.mjs, binary → dist/binary.mjs
            fileName: (_format, entryName) => `${entryName}.mjs`,
            formats: ['es']
        },
        rollupOptions: {
            external: ['konva', 'canvas', 'mudlet-map-binary-reader']
        },
        sourcemap: true,
        emptyOutDir: true
    },
    server: {
        open: true,
        port: 5173
    }
}));
