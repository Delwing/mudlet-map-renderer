import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import path from 'path';

export default defineConfig(({ command }) => ({
    root: command === 'serve' ? 'demo' : '.',
    resolve: {
        alias: [
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
                bigmap: 'src/bigmap/index.ts',
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
