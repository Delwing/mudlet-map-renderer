import {defineConfig} from 'vite';
import path from 'path';

export default defineConfig({
    root: 'bench',
    resolve: {
        alias: {
            '@src': path.resolve(__dirname, 'src'),
        },
    },
    server: {
        port: 5175,
        open: true,
    },
});
