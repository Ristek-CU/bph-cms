/**
 * Guard origin panel.
 *
 * Production: panel disajikan sebagai aset Worker di origin yang sama, jadi
 * `Origin` harus persis sama dengan origin request. Itu yang mencegah CSRF pada
 * cookie session.
 *
 * Development: panel biasanya jalan di Vite (port lain) dan mem-proxy `/api/v1`
 * ke `wrangler dev`. Vite menulis ulang `Host` menjadi origin Worker
 * (`changeOrigin: true`) tetapi meneruskan `Origin` asli browser, sehingga
 * perbandingan ketat selalu gagal ("Invalid session request origin") dan login
 * lokal tidak pernah bisa.
 *
 * Karena itu ada pengecualian yang HANYA hidup saat `ALLOW_DEV_AUTH=true` dan
 * request datang lewat hostname lokal — kombinasi yang sama dengan dev-auth
 * fallback dan tidak pernah ter-set di production.
 */

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]", "::1"];

export const isLocalHostname = (hostname: string): boolean => LOCAL_HOSTNAMES.includes(hostname);

const hostnameOf = (value: string | undefined): string | null => {
	if (!value) return null;
	try {
		return new URL(value).hostname;
	} catch {
		return null;
	}
};

/**
 * True bila `origin` adalah panel dev lokal yang boleh dipercaya saat
 * `ALLOW_DEV_AUTH=true`. Semua syarat harus terpenuhi:
 * - flag dev aktif (tidak pernah ada di vars production),
 * - request Worker sendiri datang lewat hostname lokal,
 * - Origin pengirim juga hostname lokal.
 */
export function allowsDevPanelOrigin(
	env: { ALLOW_DEV_AUTH?: string },
	requestUrl: string,
	origin: string | undefined,
): boolean {
	if (env.ALLOW_DEV_AUTH !== "true") return false;
	const requestHost = hostnameOf(requestUrl);
	if (!requestHost || !isLocalHostname(requestHost)) return false;
	const originHost = hostnameOf(origin);
	return originHost !== null && isLocalHostname(originHost);
}