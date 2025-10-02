import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(({ command }) => ({
    root: command === 'serve' ? 'demo' : '.',
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
            fileName: (format) => (format === 'es' ? 'index.mjs' : 'index.cjs'),
            formats: ['es', 'cjs']
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