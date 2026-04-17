import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import path from 'path';

export default defineConfig(({ command }) => ({
    root: command === 'serve' ? 'demo' : '.',
    resolve: {
        alias: {
            '@src': path.resolve(__dirname, 'src'),
        },
    },
    plugins: [
        dts({
            include: ['src'],
            outDir: 'dist'
        })
    ],
    build: {
        lib: {
            entry: 'src/index.ts',
            name: 'mudlet-map-renderer',
            fileName: () => 'index.mjs',
            formats: ['es']
        },
        rollupOptions: {
            external: ['konva', 'canvas']
        },
        sourcemap: true,
        emptyOutDir: true
    },
    server: {
        open: true,
        port: 5173
    }
}));