import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText } from "../api.js";
import { ErrorState, SkeletonCard } from "./ui.jsx";

// SCALE_LABEL duplikat kecil dari pages/Qpr.jsx — dipisah agar file ini mandiri.
const SCALE_LABEL = { 1: "Sangat Kurang", 2: "Kurang", 3: "Cukup", 4: "Baik", 5: "Sangat Baik" };
// Ramp merah→hijau untuk nilai 1..5, selaras palet brand panel.
const SCALE_COLORS = { 1: "#ef4444", 2: "#f97316", 3: "#eab308", 4: "#84cc16", 5: "#22c55e" };

const round2 = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : null);

/** Agregasi mean skala per section dari distribusi rekap (weighted). */
const sectionMean = (section) => {
	let sum = 0, count = 0;
	for (const q of section.questions ?? []) {
		if (q.type !== "scale" || !q.distribution) continue;
		for (const d of q.distribution) { count += d.count; sum += d.value * d.count; }
	}
	return count ? round2(sum / count) : null;
};

/** Distribusi 1–5 agregat untuk satu section (gabung semua pertanyaan skala). */
const sectionDistribution = (section) => {
	const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
	for (const q of section.questions ?? []) {
		if (q.type !== "scale" || !q.distribution) continue;
		for (const d of q.distribution) counts[d.value] += d.count;
	}
	return counts;
};

/** Rata-rata mean per pertanyaan di satu section (setara avg_question_mean server). */
const sectionAvgQuestionMean = (section) => {
	const means = (section.questions ?? []).filter((q) => q.type === "scale" && typeof q.mean === "number").map((q) => q.mean);
	return means.length ? round2(means.reduce((a, b) => a + b, 0) / means.length) : null;
};

function StatCards({ recap, detail }) {
	const done = recap?.done_entries ?? 0;
	const total = recap?.total_entries ?? 0;
	const pct = total ? Math.round((done / total) * 100) : 0;
	const sections = recap?.sections ?? [];
	const allMeans = sections.map(sectionAvgQuestionMean).filter((v) => typeof v === "number");
	const overall = allMeans.length ? round2(allMeans.reduce((a, b) => a + b, 0) / allMeans.length) : null;
	return (
		<div className="stat-grid">
			<div className="stat hero"><div className="num">{done}</div><div className="lbl">Respons final</div></div>
			<div className="stat"><div className="num">{pct}%</div><div className="lbl">Partisipasi ({done}/{total})</div></div>
			<div className="stat"><div className="num">{overall ?? "—"}</div><div className="lbl">Rata-rata skor /5</div></div>
			<div className="stat"><div className="num">{detail?.respondents ?? 0}</div><div className="lbl">Responden tercatat</div></div>
		</div>
	);
}

function ParticipationDonut({ done, total }) {
	const pct = total ? (done / total) * 100 : 0;
	return (
		<div className="card">
			<h3 style={{ marginTop: 0 }}>Partisipasi</h3>
			<div className="qpr-viz-grid">
				<div
					className="poll-pie"
					style={{ background: `conic-gradient(var(--teal) 0% ${pct}%, var(--bg) ${pct}% 100%)` }}
					role="img"
					aria-label={`Partisipasi ${Math.round(pct)}% — ${done} dari ${total} pengisi`}
				>
					<div className="poll-pie-hole"><strong>{Math.round(pct)}%</strong><span>{done}/{total}</span></div>
				</div>
				<div className="qpr-donut-legend">
					<span><i className="poll-dot" style={{ background: "var(--teal)" }} /> Sudah mengisi ({done})</span>
					<span><i className="poll-dot" style={{ background: "var(--line)" }} /> Belum mengisi ({total - done})</span>
				</div>
			</div>
		</div>
	);
}

function TargetRanking({ sections }) {
	const rows = useMemo(() => sections
		.map((s) => ({ id: s.id, label: s.target_label ? `${s.target_label} — ${s.title}` : s.title, mean: sectionAvgQuestionMean(s) }))
		.filter((r) => typeof r.mean === "number")
		.sort((a, b) => b.mean - a.mean), [sections]);
	if (!rows.length) return null;
	return (
		<div className="card">
			<h3 style={{ marginTop: 0 }}>Ranking target (rata-rata /5)</h3>
			<div className="poll-bars" role="img" aria-label={rows.map((r) => `${r.label}: ${r.mean}`).join(", ")}>
				{rows.map((r) => (
					<div key={r.id} className="poll-bar-row">
						<div className="poll-bar-top">
							<span className="poll-bar-name">{r.label}</span>
							<strong className="poll-bar-count">{r.mean}</strong>
						</div>
						<div className="poll-bar-track"><div className="poll-bar-fill" style={{ width: `${(r.mean / 5) * 100}%` }} /></div>
					</div>
				))}
			</div>
		</div>
	);
}

function ScaleLegend() {
	return (
		<div className="qpr-scale-chips">
			{[1, 2, 3, 4, 5].map((v) => (
				<span key={v} className="qpr-scale-chip" data-value={v}>{v} — {SCALE_LABEL[v]}</span>
			))}
		</div>
	);
}

function InsightCards({ sections }) {
	const rows = useMemo(() => sections
		.map((s) => ({ id: s.id, label: s.target_label ? `${s.target_label} — ${s.title}` : s.title, mean: sectionAvgQuestionMean(s), section: s }))
		.filter((r) => typeof r.mean === "number"), [sections]);
	if (!rows.length) return null;
	const sorted = [...rows].sort((a, b) => b.mean - a.mean);
	const best = sorted[0];
	const worst = sorted.length > 1 ? sorted[sorted.length - 1] : null;
	// Pertanyaan "merah": mean < 3 atau ≥40% jawaban di skor 1–2.
	const weakQuestions = [];
	for (const r of rows) {
		for (const q of r.section.questions ?? []) {
			if (q.type !== "scale" || typeof q.mean !== "number") continue;
			const low = (q.distribution ?? []).filter((d) => d.value <= 2).reduce((a, d) => a + d.count, 0);
			const total = (q.distribution ?? []).reduce((a, d) => a + d.count, 0);
			if (q.mean < 3 || (total && low / total >= 0.4)) weakQuestions.push({ label: q.label, target: r.label, mean: q.mean });
		}
	}
	weakQuestions.sort((a, b) => a.mean - b.mean);
	return (
		<div className="card">
			<h3 style={{ marginTop: 0 }}>Insight &amp; rekomendasi</h3>
			<ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
				{best && <li><strong>{best.label}</strong> mendapat penilaian tertinggi ({best.mean}/5) — pertahankan dan jadikan contoh praktik baik.</li>}
				{worst && worst.id !== best.id && <li><strong>{worst.label}</strong> paling perlu perhatian ({worst.mean}/5) — prioritaskan pendampingan atau diskusi refleksi.</li>}
				{weakQuestions.slice(0, 3).map((q) => (
					<li key={q.label}><span className="qpr-scale-chip" data-value="2" style={{ marginRight: 6 }}>perlu perbaikan</span>&ldquo;{q.label}&rdquo; pada {q.target} (rata-rata {q.mean}/5).</li>
				))}
				{!worst && !weakQuestions.length && best && <li className="muted">Belum cukup sinyal untuk rekomendasi — tunggu respons lebih banyak.</li>}
			</ul>
		</div>
	);
}

function SectionTexts({ sections }) {
	const groups = useMemo(() => (sections ?? [])
		.map((s) => ({
			label: s.target_label ? `${s.target_label} — ${s.title}` : s.title,
			texts: (s.questions ?? []).filter((q) => q.type === "text").flatMap((q) => (q.texts ?? []).map((t) => ({ q: q.label, t }))),
		}))
		.filter((g) => g.texts.length), [sections]);
	if (!groups.length) return null;
	return (
		<div className="card">
			<h3 style={{ marginTop: 0 }}>Masukan tertulis (anonim)</h3>
			{groups.map((g) => (
				<div key={g.label} style={{ marginBottom: 12 }}>
					<strong className="small">{g.label}</strong>
					<ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
						{g.texts.map((x, i) => <li key={i}>&ldquo;{x.t}&rdquo; <span className="muted small">({x.q})</span></li>)}
					</ul>
				</div>
			))}
			<p className="muted small" style={{ marginBottom: 0 }}>Masukan ditampilkan tanpa identitas pengisi.</p>
		</div>
	);
}

function DistributionDonut({ sections }) {
	const [target, setTarget] = useState(sections[0]?.id || "");
	// Refresh bisa menambahkan section baru; pilihan lama yang hilang fallback ke yang pertama.
	const section = sections.find((s) => s.id === target) ?? sections[0];
	if (!section) return null;
	const counts = sectionDistribution(section);
	const total = Object.values(counts).reduce((a, b) => a + b, 0);
	const mean = sectionMean(section);
	const segments = [];
	let cursor = 0;
	for (const v of [1, 2, 3, 4, 5]) {
		const share = total ? (counts[v] / total) * 100 : 0;
		segments.push(`${SCALE_COLORS[v]} ${cursor}% ${cursor + share}%`);
		cursor += share;
	}
	return (
		<div className="card">
			<label className="field-label" htmlFor="qpr-an-target">Distribusi skor per target</label>
			<select id="qpr-an-target" value={target} onChange={(e) => setTarget(e.target.value)}>
				{sections.map((s) => <option key={s.id} value={s.id}>{s.target_label ? `${s.target_label} — ${s.title}` : s.title}</option>)}
			</select>
			<div className="qpr-viz-grid" style={{ marginTop: 12 }}>
				<div
					className="poll-pie"
					style={{ background: total ? `conic-gradient(${segments.join(",")})` : "var(--bg)" }}
					role="img"
					aria-label={`Distribusi ${section.target_label || section.title}: ${[1, 2, 3, 4, 5].map((v) => `${v}=${counts[v]}`).join(", ")}`}
				>
					<div className="poll-pie-hole"><strong>{mean ?? "—"}</strong><span>rata-rata</span></div>
				</div>
				<div className="qpr-donut-legend">
					{[5, 4, 3, 2, 1].map((v) => (
						<span key={v}><i className="poll-dot" style={{ background: SCALE_COLORS[v] }} /> {v} {SCALE_LABEL[v]} ({counts[v]})</span>
					))}
				</div>
			</div>
		</div>
	);
}

function DivisionTable({ rows }) {
	if (!rows?.length) return null;
	return (
		<div className="card tbl-wrap">
			<h3 style={{ marginTop: 0 }}>Per divisi pengisi</h3>
			<table className="tbl">
				<thead><tr><th scope="col">Divisi</th><th scope="col">Responden</th><th scope="col">Rata-rata poin</th><th scope="col">Tertinggi</th><th scope="col">Terendah</th></tr></thead>
				<tbody>
					{rows.map((r, i) => (
						<tr key={r.division_slug ?? `merged-${i}`}>
							<td>{r.division_slug ?? "digabung (n<3)"}</td>
							<td>{r.respondents}</td>
							<td>{r.mean ?? "—"}</td>
							<td>{r.max ?? "—"}</td>
							<td>{r.min ?? "—"}</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="muted small">Kelompok dengan kurang dari 3 responden digabung demi anonimitas — rata-rata tidak ditampilkan.</p>
		</div>
	);
}

function TrendColumns({ overview, currentId }) {
	const rows = (overview ?? []).filter((p) => typeof p.avg_question_mean === "number");
	if (rows.length < 2) return null;
	return (
		<div className="card">
			<h3 style={{ marginTop: 0 }}>Tren lintas kampanye</h3>
			<p className="muted small" style={{ marginBottom: 10 }}>Rata-rata skor pertanyaan per kampanye (skala 1–5) — bukan total poin, karena panjang jalur tiap pengisi berbeda.</p>
			<div className="trend-row">
				{rows.map((p) => (
					<div key={p.period_id} className="trend-col" title={`${p.title}: ${p.avg_question_mean} · partisipasi ${p.participation_pct}%`}>
						<span className="small" style={{ fontWeight: 600 }}>{p.avg_question_mean}</span>
						<div className="trend-bar" style={{ height: `${Math.max(4, (p.avg_question_mean / 5) * 120)}px`, ...(p.period_id === currentId ? { background: "var(--gold)" } : {}) }} />
						<span className="muted" style={{ fontSize: 11, textAlign: "center", maxWidth: 80, overflowWrap: "anywhere" }}>{p.title}</span>
					</div>
				))}
			</div>
		</div>
	);
}

export default function QprAnalytics({ periodId, period }) {
	const [recap, setRecap] = useState(null);
	const [detail, setDetail] = useState(null);
	const [overview, setOverview] = useState(null);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [updatedAt, setUpdatedAt] = useState(null);
	const snapshot = !Array.isArray(period?.questions) && Boolean(period?.questions && typeof period.questions === "object");
	const open = period?.status === "open";

	const load = useCallback(async (initial) => {
		if (initial) { setLoading(true); setError(""); }
		else setRefreshing(true);
		try {
			const [rc, dt, ov] = await Promise.all([
				api(`/admin/qpr/periods/${periodId}/recap-v2`),
				api(`/admin/qpr/periods/${periodId}/analytics`),
				api(`/admin/qpr/analytics`).catch(() => null),
			]);
			setRecap(rc); setDetail(dt); setOverview(Array.isArray(ov) ? ov : null);
			setUpdatedAt(new Date());
		} catch (e) {
			if (initial) setError(errText(e));
		} finally {
			if (initial) setLoading(false); else setRefreshing(false);
		}
	}, [periodId]);

	useEffect(() => {
		if (!snapshot) return;
		let active = true;
		load(true);
		// Auto-refresh 30 dtk hanya saat kampanye open — respons baru bisa masuk kapan saja.
		const timer = open ? setInterval(() => { if (active) load(false); }, 30_000) : null;
		return () => { active = false; if (timer) clearInterval(timer); };
	}, [snapshot, load, open]);

	if (!snapshot) {
		return (
			<div className="card">
				<p className="login-notice">Analitik hanya tersedia untuk kampanye rubrik (snapshot). Kampanye lama — lihat tab Respons untuk rekap.</p>
			</div>
		);
	}
	if (loading) return <SkeletonCard lines={6} />;
	if (error) return <ErrorState message={error} onRetry={() => load(true)} />;
	if (!recap) return null;

	return (
		<div className="qpr-analytics">
			<div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
				<span className="muted small">
					{updatedAt ? `Diperbarui ${updatedAt.toLocaleTimeString("id-ID")}${open ? " · auto-refresh 30 dtk" : ""}` : ""}
				</span>
				<button className="btn ghost sm" onClick={() => load(false)} disabled={refreshing}>
					{refreshing ? "Memuat…" : "Muat ulang"}
				</button>
			</div>
			<StatCards recap={recap} detail={detail} />
			{!recap.done_entries && (
				<div className="card"><p className="login-notice" style={{ margin: 0 }}>Belum ada penilaian final — chart akan terisi otomatis saat respons masuk.</p></div>
			)}
			<InsightCards sections={recap.sections ?? []} />
			<ParticipationDonut done={recap.done_entries} total={recap.total_entries} />
			<TargetRanking sections={recap.sections ?? []} />
			<DistributionDonut sections={recap.sections ?? []} />
			<ScaleLegend />
			<DivisionTable rows={detail?.by_division} />
			<SectionTexts sections={recap.sections ?? []} />
			<TrendColumns overview={overview} currentId={periodId} />
		</div>
	);
}
