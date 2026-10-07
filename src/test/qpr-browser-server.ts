// @ts-nocheck
// Local-only browser bridge to the real Worker/D1 harness; AUTH_SERVICE uses its existing fixture.
import { createServer } from 'node:http';
import { startHarness } from './harness';

const harness = await startHarness();
const server = createServer(async (request, response) => {
	try {
		if (request.url === '/health') {
			response.writeHead(200);
			response.end('ready');
			return;
		}
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = Buffer.concat(chunks);
		const headers = Object.fromEntries(Object.entries(request.headers)
			.filter(([, value]) => typeof value === 'string'));
		const result = await harness.req(request.url, {
			method: request.method,
			headers,
			host: 'localhost:5189',
			...(body.length ? { body } : {}),
		});
		// The harness decodes the body (including stripping a UTF-8 BOM), so recalculate its byte length.
		const responseHeaders = new Headers(result.headers);
		responseHeaders.delete('content-length');
		response.writeHead(result.status, Object.fromEntries(responseHeaders));
		response.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
	} catch (error) {
		console.error(error);
		response.writeHead(500);
		response.end('Browser test bridge failed');
	}
});
server.listen(8791, 'localhost');
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, async () => {
		server.close();
		await harness.dispose();
		process.exit(0);
	});
}
