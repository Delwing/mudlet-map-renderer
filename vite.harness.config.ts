import { defineConfig } from 'vite';

export default defineConfig({
    root: 'tests/visual/harness',
    server: {
        port: 5174,
        strictPort: true,
    },
});
