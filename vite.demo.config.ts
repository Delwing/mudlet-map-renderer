import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
    root: 'demo',
    resolve: {
        alias: {
            '@src': path.resolve(__dirname, 'src')
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true
    }
});
