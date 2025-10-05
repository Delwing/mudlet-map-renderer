import {defineConfig} from "vitest/config";

export default defineConfig({
    root: __dirname,
    test: {
        include: ["tests/**/*.test.ts"],
        environment: "node",
    },
});
