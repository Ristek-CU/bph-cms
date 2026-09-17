// Roro AI — halaman chat asisten (landing setelah login). Pola ala ChatGPT:
// daftar percakapan kiri, bubble chat kanan, draf event/form muncul sebagai kartu
// proposal dengan tombol konfirmasi. Backend: src/modules/assistant/.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, errText, fmtRange } from "../api.js";
import { useToast } from "../components/ui.jsx";
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

// Kartu proposal di dalam bubble assistant.
function ProposalCard({ proposal, status, resultResourceId, onConfirm, busy }) {
	const toast = useToast();

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
				<ProposalActions {...{ status, resultResourceId, onConfirm, busy, toast }} label="Iya, buatkan event" />
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
				<ProposalActions {...{ status, resultResourceId, onConfirm, busy, toast }} label="Iya, buatkan form" />
			</div>
		);
	}
	return null;
}

function ProposalActions({ status, resultResourceId, onConfirm, busy, toast, label }) {
	if (status === "executed") {
		const target = resultResourceId
			? `/events/${resultResourceId}/edit`
			: null;
		return (
			<p className="roro-done">
				<IconCheck size={14} /> Draf dibuat.{" "}
				<Link to="/events">Buka Event</Link> · <Link to="/forms">Buka Form</Link>
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

// Satu percakapan: welcome screen atau bubble list.
function ChatView({ messages, onConfirm, busyConfirm, convId }) {
	const endRef = useRef(null);
	useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages.length]);

	if (!messages.length) {
		return (
			<div className="roro-welcome">
				<h2>Hai, aku Roro 👋</h2>
				<p>Bisa bantu apa hari ini?</p>
				<div className="roro-suggest">
					<button className="btn ghost" onClick={() => window.dispatchEvent(new CustomEvent("roro:prompt", { detail: "Bantu aku buat event lomba futsal" }))}>
						Buat event futsal
					</button>
					<button className="btn ghost" onClick={() => window.dispatchEvent(new CustomEvent("roro:prompt", { detail: "Buat form pendaftaran panitia" }))}>
						Buat form pendaftaran
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="roro-thread">
			{messages.map((m) => (
				<div key={m.id} className={`roro-msg ${m.role}`}>
					<div className="roro-bubble">
						<span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
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
			<div ref={endRef} />
		</div>
	);
}

export default function Assistant({ user }) {
	const toast = useToast();
	const [conversations, setConversations] = useState([]);
	const [convId, setConvId] = useState(null);
	const [messages, setMessages] = useState([]);
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [busyConfirm, setBusyConfirm] = useState(false);
	const [listOpen, setListOpen] = useState(false); // mobile
	const inputRef = useRef(null);

	const loadConversations = useCallback(async () => {
		try {
			const d = await api("/admin/assistant/conversations");
			setConversations(d || []);
		} catch {
			/* daftar kosong tidak fatal */
		}
	}, []);

	const openConversation = useCallback(async (id) => {
		setConvId(id);
		setListOpen(false);
		try {
			const d = await api(`/admin/assistant/conversations/${id}`);
			setMessages(d || []);
		} catch (e) {
			toast(errText(e), "err");
		}
	}, [toast]);

	const send = useCallback(
		async (text) => {
			const message = (text ?? input).trim();
			if (!message || busy) return;
			setBusy(true);
			setInput("");
			setMessages((m) => [
				...m,
				{ id: `tmp-${Date.now()}`, role: "user", content: message },
			]);
			try {
				const d = await api("/admin/assistant/chat", {
					method: "POST",
					json: { conversation_id: convId ?? undefined, message },
				});
				setMessages((m) => [
					...m,
					{
						id: d.message_id,
						role: "assistant",
						content: d.reply,
						proposal_json: d.proposal,
						proposal_status: d.proposal ? "pending" : null,
						result_resource_id: null,
					},
				]);
				if (!convId) {
					setConvId(d.conversation_id);
					loadConversations();
				}
			} catch (e) {
				toast(errText(e), "err");
				setMessages((m) => m.filter((x) => !x.id.startsWith("tmp-")));
				setInput(message);
			} finally {
				setBusy(false);
				inputRef.current?.focus();
			}
		},
		[input, busy, convId, toast, loadConversations],
	);

	const confirmProposal = useCallback(
		async (msg) => {
			setBusyConfirm(true);
			try {
				const d = await api("/admin/assistant/confirm", {
					method: "POST",
					json: { conversation_id: convId, message_id: msg.id },
				});
				setMessages((m) =>
					m.map((x) =>
						x.id === msg.id
							? { ...x, proposal_status: "executed", result_resource_id: d.resource_id }
							: x,
					),
				);
				toast(d.tool === "create_event" ? "Draft event dibuat." : "Draft form dibuat.");
			} catch (e) {
				toast(errText(e), "err");
				if (e?.statusCode === 404) {
					setMessages((m) => m.map((x) => (x.id === msg.id ? { ...x, proposal_status: "rejected" } : x)));
				}
			} finally {
				setBusyConfirm(false);
			}
		},
		[convId, toast],
	);

	// Suggestion chip → isi input & kirim.
	useEffect(() => {
		const h = (e) => send(e.detail);
		window.addEventListener("roro:prompt", h);
		return () => window.removeEventListener("roro:prompt", h);
	}, [send]);

	const newChat = () => {
		setConvId(null);
		setMessages([]);
		setListOpen(false);
	};

	const removeConversation = async (id) => {
		try {
			await api(`/admin/assistant/conversations/${id}`, { method: "DELETE" });
			if (id === convId) newChat();
			loadConversations();
		} catch (e) {
			toast(errText(e), "err");
		}
	};

	return (
		<div className="roro-layout">
			{/* Daftar percakapan */}
			<aside className={`roro-sidebar ${listOpen ? "open" : ""}`}>
				<button className="btn gold roro-new" onClick={newChat}>
					<IconPlus size={14} /> Chat baru
				</button>
				<div className="roro-conv-list">
					{conversations.map((c) => (
						<div key={c.id} className={`roro-conv ${c.id === convId ? "active" : ""}`}>
							<button onClick={() => openConversation(c.id)} title={c.title}>
								{c.title}
							</button>
							<button className="roro-del" onClick={() => removeConversation(c.id)} title="Hapus">
								<IconTrash size={13} />
							</button>
						</div>
					))}
				</div>
			</aside>

			{/* Thread */}
			<div className="roro-main">
				<ChatView messages={messages} onConfirm={confirmProposal} busyConfirm={busyConfirm} convId={convId} />
				<form
					className="roro-input"
					onSubmit={(e) => {
						e.preventDefault();
						send();
					}}
				>
					<input
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Tanya Roro…"
						disabled={busy}
						autoFocus
					/>
					<button className="btn gold" disabled={busy || !input.trim()}>
						{busy ? "…" : "Kirim"}
					</button>
				</form>
			</div>
		</div>
	);
}
