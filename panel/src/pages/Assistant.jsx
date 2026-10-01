// Roro AI — halaman chat asisten (landing setelah login). Pola ala ChatGPT:
// daftar percakapan kiri, bubble chat kanan, draf event/form muncul sebagai kartu
// proposal dengan tombol konfirmasi. Backend: src/modules/assistant/.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { getSessionGeneration, invalidateSession, api, errText, fmtRange, getToken, ApiFail } from "../api.js";
import { useToast, Confirm, SkeletonCard, ErrorState, useEscape, useFocusTrap } from "../components/ui.jsx";
import { IconPlus, IconTrash, IconCheck } from "../components/Icons.jsx";

const FIELD_TYPE_LABEL = {
	short_text: "Jawaban singkat",
	paragraph: "Paragraf",
	email: "Email",
	number: "Angka",
	multiple_choice: "Pilihan ganda",
	checkboxes: "Kotak centang",
	dropdown: "Dropdown",
	linear_scale: "Skala",
	date: "Tanggal",
	file: "Upload file",
};

// Chat panel tampil teks polos — LLM kadang masih nyelipin simbol markdown.
// Buang yang paling umum: bold/italic bintang, heading, backtick, dash bullet,
// tabel pipe di awal baris.
const stripMd = (s) =>
	s
		.replace(/<｜?DSML｜>[\s\S]*?(?:<\/｜?DSML｜>|$)/g, "")
		.replace(/<｜DSML｜[\s\S]*/g, "")
		.replace(/\*\*([^*]*)\*\*/g, "$1")
		.replace(/\*([^*\n]+)\*/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/^\s*[-•]\s+/gm, "")
		.replace(/^\s*\|.*\|\s*$/gm, "");

// Kartu proposal di dalam bubble assistant.
function ProposalCard({ proposal, status, resultResourceId, onConfirm, busy }) {
	if (proposal.tool === "create_internal_event") {
		const d = proposal.data;
		return (
			<div className="card roro-proposal">
				<p className="card-title">Draf Event Internal</p>
				<h3>{d.title}</h3>
				<p className="small">{d.description}</p>
				<p className="small"><strong>{fmtRange(d.starts_at, d.ends_at)}</strong></p>
				<p className="small">📍 {d.location}</p>
				{d.organizer && <p className="small">Penyelenggara: {d.organizer}</p>}
				{d.sessions?.length > 0 && (
					<div className="roro-runsheet">
						{d.sessions.map((s, i) => (
							<div key={i} className="roro-session">
								<strong>{s.name}</strong>
								<span className="small"> {fmtRange(s.starts_at, s.ends_at)}</span>
								{s.speaker && <span className="small"> · {s.speaker}</span>}
							</div>
						))}
					</div>
				)}
				<ProposalActions {...{ status, resultResourceId, onConfirm, busy }} tool="create_internal_event" label="Iya, buatkan agenda internal" />
			</div>
		);
	}

	if (proposal.tool === "create_event") {
		const d = proposal.data;
		return (
			<div className="card roro-proposal">
				<p className="card-title">Draf Event</p>
				<h3>{d.title}</h3>
				<p className="small">{d.description}</p>
				<p className="small"><strong>{fmtRange(d.starts_at, d.ends_at)}</strong></p>
				<p className="small">📍 {d.location}</p>
				{d.organizer && <p className="small">Penyelenggara: {d.organizer}</p>}
				{d.sessions?.length > 0 && (
					<div className="roro-runsheet">
						{d.sessions.map((s, i) => (
							<div key={i} className="roro-session">
								<strong>{s.name}</strong>
								<span className="small"> {fmtRange(s.starts_at, s.ends_at)}</span>
								{s.speaker && <span className="small"> · {s.speaker}</span>}
							</div>
						))}
					</div>
				)}
				<ProposalActions {...{ status, resultResourceId, onConfirm, busy }} tool="create_event" label="Iya, buatkan event" />
			</div>
		);
	}

	if (proposal.tool === "create_form") {
		const d = proposal.data;
		return (
			<div className="card roro-proposal">
				<p className="card-title">Draf Form</p>
				<h3>{d.title}</h3>
				<p className="small">{d.description}</p>
				<ol className="roro-fields">
					{(d.fields ?? []).map((f, i) => (
						<li key={i}>
							{f.label}{" "}
							<span className="badge">{FIELD_TYPE_LABEL[f.type] ?? f.type}</span>
							{f.required && <span className="badge req">wajib</span>}
						</li>
					))}
				</ol>
				<ProposalActions {...{ status, resultResourceId, onConfirm, busy }} tool="create_form" label="Iya, buatkan form" />
			</div>
		);
	}
	return null;
}

function ProposalActions({ status, resultResourceId, onConfirm, busy, tool, label }) {
	if (status === "executed") {
		const target = resultResourceId
			? (tool === "create_form" ? `/forms/${resultResourceId}` : tool === "create_internal_event" ? `/internal-events/${resultResourceId}` : `/events/${resultResourceId}/edit`)
			: null;
		const noun = tool === "create_form" ? "form" : tool === "create_internal_event" ? "agenda internal" : "event";
		return (
			<p className="roro-done">
				<IconCheck size={14} /> Draf dibuat.{" "}
				<Link to={target || (tool === "create_form" ? "/forms" : tool === "create_internal_event" ? "/internal-events" : "/events")}>Buka {noun}</Link>
			</p>
		);
	}
	if (status === "rejected") return <p className="roro-done muted">Draf dibatalkan.</p>;
	return (
		<button className="btn gold" disabled={busy} onClick={onConfirm}>
			{busy ? "Membuat…" : label}
		</button>
	);
}

function ThinkingBubble({ text, label, startedAt }) {
	const [seconds, setSeconds] = useState(() => Math.max(0, Math.floor((Date.now() - (startedAt || Date.now())) / 1000)));
	useEffect(() => {
		const start = startedAt || Date.now();
		const timer = setInterval(() => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000))), 1000);
		return () => clearInterval(timer);
	}, [startedAt]);
	return (
		<div className="roro-msg assistant">
			<Avatar animate />
			<div className="roro-bubble roro-thinking">
				<p className="roro-thinking-label">{seconds >= 45 ? "Roro masih mencoba menghubungi AI…" : label || (seconds < 15 ? "Roro lagi mikir…" : "Roro sedang menyiapkan jawaban…")}</p>
				<p className="roro-thinking-text">{text.slice(-180)} {seconds > 4 ? `${seconds} dtk` : ""}</p>
			</div>
		</div>
	);
}

// Maskot Roro (panel/public/roro.png). Saat Roro "bekerja" (streaming),
// avatar berdenyut — kesan AI agent yang hidup, bukan ikon mati.
function Avatar({ animate = false }) {
	return (
		<img
			src="/roro.png"
			alt=""
			aria-hidden
			className={`roro-avatar ${animate ? "roro-avatar-live" : ""}`}
			draggable={false}
		/>
	);
}

// Satu percakapan: welcome screen atau bubble list.
function ChatView({ messages, onConfirm, busyConfirm, streaming }) {
	const endRef = useRef(null);
	useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages.length, streaming?.thinking]);

	if (!messages.length && !streaming) {
		return (
			<div className="roro-welcome">
				<img src="/roro.png" alt="" aria-hidden className="roro-welcome-logo" draggable={false} />
				<h2>Hai, aku Roro</h2>
				<p>Bisa bantu apa hari ini?</p>
				{/* Tips cara pakai — teks biasa, bukan tombol. Contoh dicontoh user langsung. */}
				<div className="roro-tips">
					<p><em>Contoh:</em> "Buat event lomba futsal minggu depan"</p>
					<p><em>Contoh:</em> "Buat form pendaftaran panitia"</p>
					<p><em>Contoh:</em> "Lihat event apa saja bulan ini"</p>
					<p><em>Contoh:</em> "Buat event internal untuk koordinasi BPH"</p>
				</div>
			</div>
		);
	}

	return (
		<div className="roro-thread">
			{messages.map((m) => (
				<div key={m.id} className={`roro-msg ${m.role}`}>
					{m.role === "assistant" && <Avatar />}
					<div className="roro-bubble">
						<span style={{ whiteSpace: "pre-wrap" }}>{m.role === "assistant" ? stripMd(m.content) : m.content}</span>
						{m.role === "assistant" && m.proposal_json && (
							<ProposalCard
								proposal={m.proposal_json}
								status={m.proposal_status}
								resultResourceId={m.result_resource_id}
								busy={busyConfirm}
								onConfirm={() => onConfirm(m)}
							/>
						)}
					</div>
				</div>
			))}
			{streaming && (streaming.phase === "thinking" || streaming.phase === "working" ? <ThinkingBubble text={streaming.thinking ?? ""} label={streaming.label} startedAt={streaming.startedAt} /> : null)}
			<div ref={endRef} />
		</div>
	);
}

// Session state singleton: tetap hidup saat user pindah rute di SPA (Events, Forms, dll)
// dan kembali lagi ke Roro tanpa kehilangan prompt atau menghentikan streaming AI.
let roroSession = {
	convId: sessionStorage.getItem("roro_conv_id") || null,
	messages: [],
	busy: false,
	streaming: null, // { phase, thinking, label, startedAt }
	busyConfirm: false,
};

const sessionListeners = new Set();
let activeStreamController = null;
let activeRequestVersion = 0;

function emitSessionChange(partial) {
	roroSession = { ...roroSession, ...partial };
	for (const l of sessionListeners) {
		try { l(); } catch {}
	}
}

function subscribeRoroSession(listener) {
	sessionListeners.add(listener);
	return () => sessionListeners.delete(listener);
}

function getRoroSnapshot() {
	return roroSession;
}

export function resetRoroSession() {
	if (activeStreamController) {
		activeStreamController.abort();
		activeStreamController = null;
	}
	activeRequestVersion++;
	emitSessionChange({
		convId: null,
		messages: [],
		busy: false,
		streaming: null,
		busyConfirm: false,
	});
	sessionStorage.removeItem("roro_conv_id");
}

export default function Assistant() {
	const toast = useToast();
	const { convId, messages, busy, streaming, busyConfirm } = useSyncExternalStore(subscribeRoroSession, getRoroSnapshot);
	const [conversations, setConversations] = useState([]);
	const [input, setInput] = useState("");
	const [listOpen, setListOpen] = useState(false); // mobile
	const inputRef = useRef(null);
	const [loadingChat, setLoadingChat] = useState(false);
	const [chatError, setChatError] = useState("");
	const [listError, setListError] = useState("");
	const [deleteId, setDeleteId] = useState(null);
	const [usage, setUsage] = useState(null); // { today: {used, limit}, month: {used, limit} }
	const historyRef = useFocusTrap(listOpen);
	useEscape(() => setListOpen(false));

	useEffect(() => {
		const field = inputRef.current;
		if (!field) return;
		const resize = () => {
			field.style.height = "auto";
			field.style.height = `${Math.min(field.scrollHeight + 2, 180)}px`;
		};
		resize();
		window.addEventListener("resize", resize);
		return () => window.removeEventListener("resize", resize);
	}, [input]);

	const loadConversations = useCallback(async () => {
		try {
			const d = await api("/admin/assistant/conversations");
			setConversations(d || []);
			setListError("");
		} catch (e) {
			setListError(errText(e));
		}
	}, []);

	const pollForAssistantReply = useCallback((id, version, attempt = 0) => {
		if (attempt >= 25 || version !== activeRequestVersion) {
			if (version === activeRequestVersion) {
				emitSessionChange({ busy: false, streaming: null });
			}
			return;
		}
		setTimeout(async () => {
			if (version !== activeRequestVersion) return;
			try {
				const d = await api(`/admin/assistant/conversations/${id}`);
				if (version !== activeRequestVersion) return;
				const msgs = d || [];
				const last = msgs[msgs.length - 1];
				if (last && last.role === "assistant") {
					emitSessionChange({ messages: msgs, busy: false, streaming: null });
					api("/admin/assistant/usage").then(setUsage).catch(() => {});
				} else {
					pollForAssistantReply(id, version, attempt + 1);
				}
			} catch {
				pollForAssistantReply(id, version, attempt + 1);
			}
		}, 2500);
	}, []);

	const openConversation = useCallback(async (id) => {
		const version = ++activeRequestVersion;
		if (activeStreamController) {
			activeStreamController.abort();
			activeStreamController = null;
		}
		setListOpen(false);
		setChatError("");
		setLoadingChat(true);
		emitSessionChange({
			convId: id,
			messages: [],
			busy: false,
			streaming: null,
		});
		sessionStorage.setItem("roro_conv_id", id);
		try {
			const d = await api(`/admin/assistant/conversations/${id}`);
			if (version === activeRequestVersion) {
				const msgs = d || [];
				const last = msgs[msgs.length - 1];
				if (last && last.role === "user") {
					emitSessionChange({
						messages: msgs,
						busy: true,
						streaming: {
							phase: "thinking",
							thinking: "Roro sedang menyiapkan jawaban…",
							startedAt: last.created_at ? Date.parse(last.created_at) : Date.now(),
						},
					});
					pollForAssistantReply(id, version);
				} else {
					emitSessionChange({ messages: msgs, busy: false, streaming: null });
				}
			}
		} catch (e) {
			if (version !== activeRequestVersion) return;
			if (e?.statusCode === 404) {
				emitSessionChange({ convId: null, messages: [] });
				sessionStorage.removeItem("roro_conv_id");
			} else {
				setChatError(errText(e));
			}
		} finally {
			if (version === activeRequestVersion) setLoadingChat(false);
		}
	}, [pollForAssistantReply]);

	// Balik ke Roro: kalau ada percakapan tersimpan dan belum termuat, buka.
	// Jika sedang streaming, biarkan stream terus berjalan tanpa di-abort.
	useEffect(() => {
		loadConversations();
		if (roroSession.convId && roroSession.messages.length === 0 && !roroSession.busy) {
			openConversation(roroSession.convId);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Kuota harian — biar user tahu sisa chat sebelum kena 429.
	useEffect(() => {
		api("/admin/assistant/usage").then(setUsage).catch(() => {});
	}, []);

	const send = useCallback(
		async (text) => {
			const message = (text ?? input).trim();
			if (!message || roroSession.busy || roroSession.busyConfirm || loadingChat || chatError) return;
			const startedAt = Date.now();
			setInput("");
			const optimisticId = `tmp-${crypto.randomUUID()}`;
			const currentConvId = roroSession.convId;
			emitSessionChange({
				busy: true,
				messages: [
					...roroSession.messages,
					{ id: optimisticId, role: "user", content: message },
				],
				streaming: { phase: "thinking", thinking: "", startedAt },
			});
			let streamed = "";
			const upsert = () => {
				const last = roroSession.messages[roroSession.messages.length - 1];
				const bubble = { id: "streaming", role: "assistant", content: streamed, proposal_json: null };
				const nextMessages = last?.id === "streaming"
					? [...roroSession.messages.slice(0, -1), bubble]
					: [...roroSession.messages, bubble];
				emitSessionChange({ messages: nextMessages });
			};
			let timedOut = false;
			let timeoutId;
			try {
				if (activeStreamController) {
					activeStreamController.abort();
				}
				const controller = new AbortController();
				activeStreamController = controller;
				timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, 180_000);
				const generation = getSessionGeneration();
				const res = await fetch("/api/v1/admin/assistant/chat/stream", {
					signal: controller.signal,
					method: "POST",
					headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
					body: JSON.stringify({ conversation_id: currentConvId ?? undefined, message }),
				});
				if (!res.ok) {
					if (res.status === 401) invalidateSession(generation);
					const body = await res.json().catch(() => ({}));
					throw new ApiFail(body, res.status);
				}
				const reader = res.body.getReader();
				const dec = new TextDecoder();
				let buf = "";
				let final = null;
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					buf += dec.decode(value, { stream: true });
					let idx;
					while ((idx = buf.indexOf("\n\n")) !== -1) {
						const line = buf.slice(0, idx).split("\n").find((l) => l.startsWith("data:"));
						buf = buf.slice(idx + 2);
						if (!line) continue;
						let ev;
						try {
							ev = JSON.parse(line.slice(5));
						} catch {
							continue;
						}
						if (ev.type === "start" && ev.conversation_id) {
							emitSessionChange({ convId: ev.conversation_id });
							sessionStorage.setItem("roro_conv_id", ev.conversation_id);
							loadConversations();
						} else if (ev.type === "thinking") {
							emitSessionChange({
								streaming: {
									phase: "thinking",
									thinking: (roroSession.streaming?.thinking ?? "") + ev.text,
									startedAt,
								},
							});
						} else if (ev.type === "working") {
							emitSessionChange({
								streaming: {
									phase: "working",
									thinking: "",
									label: ev.message,
									startedAt,
								},
							});
						} else if (ev.type === "text") {
							streamed += ev.text;
							emitSessionChange({
								streaming: { phase: "text", startedAt },
							});
							upsert();
						} else if (ev.type === "done") {
							final = ev;
						} else if (ev.type === "error") {
							throw new Error(ev.message);
						}
					}
				}
				if (!final) throw new Error("Stream terputus — coba lagi");
				const cleaned = roroSession.messages.filter((x) => x.id !== "streaming").map((x) =>
					final.proposal && x.proposal_status === "pending" ? { ...x, proposal_status: "rejected" } : x,
				);
				const finalAssistantMessage = {
					id: final.message_id || `blocked-${Date.now()}`,
					role: "assistant",
					content: final.reply,
					proposal_json: final.proposal,
					proposal_status: final.proposal ? "pending" : null,
					result_resource_id: null,
				};
				emitSessionChange({
					convId: final.conversation_id,
					messages: [...cleaned, finalAssistantMessage, ...(final.additional_proposals ?? [])],
					streaming: null,
					busy: false,
				});
				sessionStorage.setItem("roro_conv_id", final.conversation_id);
				loadConversations();
				api("/admin/assistant/usage").then(setUsage).catch(() => {});
			} catch (e) {
				if (e.name === "AbortError" && !timedOut) {
					return;
				}
				toast(timedOut ? "Roro terlalu lama merespons. Cek riwayat sebelum mengirim ulang." : errText(e), "err");
				emitSessionChange({
					messages: roroSession.messages.filter((x) => x.id !== optimisticId && x.id !== "streaming"),
					streaming: null,
					busy: false,
				});
				setInput(message);
				if (timedOut) loadConversations();
			} finally {
				clearTimeout(timeoutId);
				if (activeStreamController?.signal?.aborted) {
					activeStreamController = null;
				}
				inputRef.current?.focus();
			}
		},
		[input, loadingChat, chatError, toast, loadConversations],
	);

	const confirmProposal = useCallback(
		async (msg) => {
			emitSessionChange({ busyConfirm: true });
			try {
				const d = await api("/admin/assistant/confirm", {
					method: "POST",
					json: { conversation_id: roroSession.convId, message_id: msg.id },
				});
				emitSessionChange({
					messages: roroSession.messages.map((x) =>
						x.id === msg.id
							? { ...x, proposal_status: "executed", result_resource_id: d.resource_id }
							: x,
					),
				});
				if (d.tool === "create_event") window.dispatchEvent(new Event("bph:events-changed"));
				toast(d.tool === "create_internal_event" ? "Draft agenda internal dibuat." : d.tool === "create_event" ? "Draft event dibuat." : "Draft form dibuat.");
			} catch (e) {
				toast(errText(e), "err");
				if (e?.statusCode === 404) {
					emitSessionChange({
						messages: roroSession.messages.map((x) => (x.id === msg.id ? { ...x, proposal_status: "rejected" } : x)),
					});
				}
			} finally {
				emitSessionChange({ busyConfirm: false });
			}
		},
		[toast],
	);

	// Suggestion chip → isi input & kirim.
	useEffect(() => {
		const h = (e) => send(e.detail);
		window.addEventListener("roro:prompt", h);
		return () => window.removeEventListener("roro:prompt", h);
	}, [send]);

	const newChat = () => {
		activeRequestVersion++;
		if (activeStreamController) {
			activeStreamController.abort();
			activeStreamController = null;
		}
		setLoadingChat(false);
		setChatError("");
		emitSessionChange({
			convId: null,
			messages: [],
			busy: false,
			streaming: null,
		});
		sessionStorage.removeItem("roro_conv_id");
		setListOpen(false);
	};

	const removeConversation = async (id) => {
		setDeleteId(null);
		try {
			await api(`/admin/assistant/conversations/${id}`, { method: "DELETE" });
			if (id === convId) newChat();
			loadConversations();
		} catch (e) {
			toast(errText(e), "err");
		}
	};

	return (
		<>
		<div className="roro-mobile-controls"><button className="btn ghost" aria-expanded={listOpen} aria-controls="roro-history" onClick={() => setListOpen((v) => !v)}>Riwayat chat</button><button className="btn sec" disabled={busy || busyConfirm} onClick={newChat}>+ Chat baru</button></div>
		<div className="roro-layout">
			{/* Daftar percakapan */}
			<aside id="roro-history" ref={historyRef} tabIndex={-1} aria-label="Riwayat chat" className={`roro-sidebar ${listOpen ? "open" : ""}`}>
				<button className="btn ghost roro-history-close" onClick={() => setListOpen(false)}>Tutup riwayat</button>
				<button className="btn gold roro-new" disabled={busy || busyConfirm} onClick={newChat}>
					<IconPlus size={14} /> Chat baru
				</button>
				{usage?.today && (
					<p className="roro-quota small muted" title="Batas chat Roro per hari (WIB)">
						Kuota hari ini: {usage.today.used}/{usage.today.limit}
					</p>
				)}
				<div className="roro-conv-list">
					{listError && <ErrorState message={listError} onRetry={loadConversations} />}
					{!listError && !conversations.length && <p className="muted small">Percakapanmu akan muncul di sini.</p>}
					{conversations.map((c) => (
						<div key={c.id} className={`roro-conv ${c.id === convId ? "active" : ""}`}>
							<button disabled={busy || busyConfirm} onClick={() => openConversation(c.id)} title={c.title}>
								{c.title}
							</button>
							<button disabled={busy || busyConfirm} className="roro-del" onClick={() => setDeleteId(c.id)} aria-label={`Hapus percakapan ${c.title}`} title="Hapus">
								<IconTrash size={13} />
							</button>
						</div>
					))}
				</div>
			</aside>

			{/* Thread */}
			<div className="roro-main">
				{loadingChat ? <SkeletonCard lines={5} /> : chatError ? <ErrorState message={chatError} onRetry={() => openConversation(convId)} /> : <ChatView messages={messages} onConfirm={confirmProposal} busyConfirm={busyConfirm || busy} streaming={streaming} />}
				<form
					className="roro-input"
					onSubmit={(e) => {
						e.preventDefault();
						send();
					}}
				>
					<textarea
						ref={inputRef}
						rows={1}
						wrap="soft"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Tanya Roro…"
						aria-label="Pesan untuk Roro"
						disabled={busy || busyConfirm || loadingChat || !!chatError}
					/>
					<button className="btn gold roro-send" disabled={busy || busyConfirm || loadingChat || !!chatError || !input.trim()} aria-label="Kirim pesan">
						{busy ? <img src="/roro.png" alt="" aria-hidden className="roro-avatar roro-avatar-live roro-send-logo" draggable={false} /> : <img src="/roro.png" alt="" aria-hidden className="roro-send-logo" draggable={false} />}
					</button>
				</form>
			</div>
		</div>
		<Confirm open={!!deleteId} title="Hapus percakapan?" danger confirmLabel="Hapus percakapan" onCancel={() => setDeleteId(null)} onConfirm={() => removeConversation(deleteId)}>Percakapan dihapus dari riwayatmu. Salinan audit dapat dibaca Ristek selama 90 hari sebelum dihapus permanen. Event atau form yang sudah dibuat tetap tersimpan.</Confirm>
		</>
	);
}
