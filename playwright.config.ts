import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/visual',
    testMatch: '*.spec.ts',
    snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
    use: {
        baseURL: 'http://localhost:5174',
        viewport: { width: 800, height: 600 },
    },
    expect: {
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.01,
        },
    },
    webServer: {
        command: 'yarn vite --config vite.harness.config.ts',
        port: 5174,
        reuseExistingServer: !process.env.CI,
    },
});
