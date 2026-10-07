import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	testMatch: 'qpr-integration.spec.js',
	outputDir: './test-results-qpr-integration',
	workers: 1,
	timeout: 120000,
	use: {
		baseURL: 'http://localhost:5189',
		viewport: { width: 360, height: 800 },
		trace: 'retain-on-failure',
		launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
	},
	webServer: [
		{
			command: '../node_modules/.bin/tsx ../src/test/qpr-browser-server.ts',
			url: 'http://localhost:8791/health',
			reuseExistingServer: false,
			timeout: 120000,
		},
		{
			command: 'npm run dev -- --host localhost --port 5189 --strictPort',
			url: 'http://localhost:5189',
			reuseExistingServer: false,
		},
	],
});
