import {defineConfig} from 'vite';
import path from 'node:path';

// Sibling repo that owns streamRooms. We alias the package to its local
// *source* (not the published node_modules copy, which predates streamRooms,
// and not its bundled dist — the dist externalises qtdatastream, which breaks
// under Vite's dep prebundling with "Class extends undefined"). Processing the
// source as modules matches the reader's own working demo. qtdatastream/lodash
// resolve from the reader's own node_modules.
const readerRoot = path.resolve(__dirname, '../node-mudlet-map-binary-reader');

export default defineConfig({
    root: 'demo',
    resolve: {
        alias: {
            '@src': path.resolve(__dirname, 'src'),
            'mudlet-map-binary-reader': path.join(readerRoot, 'src/index.ts'),
        },
    },
    server: {
        // demo imports from ../src and the aliased sibling repo, both outside `root`.
        fs: {allow: [__dirname, readerRoot]},
    },
    build: {
        outDir: 'dist-streaming',
        emptyOutDir: true,
        rollupOptions: {
            input: {streaming: path.resolve(__dirname, 'demo/streaming.html')},
        },
    },
});
