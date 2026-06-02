/**
 * Ambient declaration for Vite's inline-worker import suffix, so `tsc`
 * type-checks `./worker?worker&inline` (Vite rewrites it at build time into a
 * self-contained Blob-URL worker constructor).
 */
declare module "*?worker&inline" {
    const WorkerFactory: {new (): Worker};
    export default WorkerFactory;
}
