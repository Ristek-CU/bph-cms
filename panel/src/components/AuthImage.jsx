import { useEffect, useState } from "react";
import { getToken } from "../api.js";

// Server mengembalikan URL absolut dari API_BASE_URL. Di production itu satu
// origin dengan panel, tetapi di dev panel jalan di :5173 dan worker di :8791 —
// fetch() ke URL absolut itu lintas origin dan kena CORS, padahal <img> tidak.
// Panel selalu mencapai API lewat path relatif /api/v1 (vite mem-proxy-nya),
// jadi URL milik API sendiri dinormalkan jadi relatif. URL gambar eksternal
// sungguhan dibiarkan apa adanya.
const toFetchable = (url) => {
	try {
		const u = new URL(url, window.location.origin);
		return u.pathname.startsWith("/api/v1/") ? `${u.pathname}${u.search}` : url;
	} catch {
		return url;
	}
};

/**
 * Gambar di balik endpoint ber-auth — dipakai cover internal event (K-6).
 *
 * Kenapa bukan <img src> polos: tag img tidak mengirim header Authorization,
 * sedangkan cover internal event dilayani /admin/internal-media/:filename yang
 * mewajibkan Bearer. Jadi objeknya diambil lewat fetch ber-token lalu dirender
 * sebagai object URL, dan URL-nya dicabut saat tidak dipakai lagi supaya tidak
 * menumpuk.
 *
 * State menyimpan `src` yang sedang diwakilinya: saat src berganti, render
 * langsung menganggap hasil lama tidak berlaku tanpa perlu setState sinkron di
 * dalam effect (yang memicu render bertingkat).
 *
 * Trade-off yang diterima: tidak ada cache lintas navigasi (tiap mount fetch
 * ulang). Untuk panel admin dengan beberapa cover per halaman itu tidak terasa.
 */
export default function AuthImage({ src, alt, className, fallback = null }) {
	const [loaded, setLoaded] = useState({ src: null, url: null, failed: false });

	useEffect(() => {
		if (!src) return;
		const controller = new AbortController();
		let cancelled = false;
		let created = null;

		fetch(toFetchable(src), {
			headers: { Authorization: `Bearer ${getToken()}` },
			signal: controller.signal,
		})
			.then((res) => {
				// Pola sama dengan api.js: 401 berarti sesi habis — biarkan App yang
				// mengembalikan user ke login, komponen ini cukup gagal senyap.
				if (res.status === 401) window.dispatchEvent(new Event("bph:unauthorized"));
				if (!res.ok) throw new Error(String(res.status));
				return res.blob();
			})
			.then((blob) => {
				created = URL.createObjectURL(blob);
				// src bisa sudah berganti sebelum blob tiba — buang hasilnya.
				if (cancelled) URL.revokeObjectURL(created);
				else setLoaded({ src, url: created, failed: false });
			})
			.catch((err) => {
				if (!cancelled && err?.name !== "AbortError") setLoaded({ src, url: null, failed: true });
			});

		return () => {
			cancelled = true;
			controller.abort();
			if (created) URL.revokeObjectURL(created);
		};
	}, [src]);

	const current = loaded.src === src ? loaded : null;
	if (!src || current?.failed) return fallback;
	if (!current?.url) {
		return (
			<div
				className={`auth-img-loading ${className || ""}`.trim()}
				role="status"
				aria-label="Memuat gambar"
			/>
		);
	}
	return <img src={current.url} alt={alt} className={className} />;
}
