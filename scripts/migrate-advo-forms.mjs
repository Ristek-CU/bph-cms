#!/usr/bin/env node
// Migrasi sekali jalan: campaign AdvocationDashboard (satgas) → CMS Hub forms.
//
// Fase 1 (di repo AdvocationDashboard, akun CF satgas):
//   node scripts/migrate-advo-forms.mjs export advo-dump.json
// Fase 2 (di repo bph-cms, akun CF hub):
//   node scripts/migrate-advo-forms.mjs import advo-dump.json [--remote]
//
// Exclude slug `student-voice` — default form pengaduan tetap milik backend
// advo permanent (keputusan produk 15 Sep 2026, lihat RESERVED_SLUGS).
//
// ponytail: shell-out ke wrangler CLI, tanpa dependency node baru. Kalau data
// > 5MB (ribuan submission) upgrade ke stream per-batch.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

const RESERVED = ["student-voice"];
const ADVO_DIVISION_SLUG = "advo"; // divisi tujuan di CMS Hub

const usage = () => {
	console.error("Pakai: migrate-advo-forms.mjs export <out.json> | import <in.json> [--remote]");
	process.exit(1);
};

const [cmd, file, ...rest] = process.argv.slice(2);
if (!cmd || !file) usage();

// Wrangler D1 query helper — exec per statement, JSON keluaran distandarkan.
function d1(sourceDir, db, sql, remote) {
	const args = ["wrangler", "d1", "execute", db, "--json", "--command", sql];
	if (remote) args.push("--remote");
	return JSON.parse(
		execFileSync("npx", args, { cwd: sourceDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
	)[0].results;
}

// ── Fase export (jalankan di repo AdvocationDashboard) ─────────────────────
if (cmd === "export") {
	const q = (sql) => d1(process.cwd(), "satgas-db", sql, rest.includes("--remote"));
	const campaigns = q("SELECT * FROM campaigns");
	const dump = { exportedAt: new Date().toISOString(), campaigns: [] };
	for (const c of campaigns) {
		if (RESERVED.includes(c.slug)) {
			console.log(`skip  ${c.slug} (reserved — tetap di backend advo)`);
			continue;
		}
		const fields = q(`SELECT * FROM campaign_fields WHERE campaign_id = ${c.id} ORDER BY sort_order`);
		const submissions = q(`SELECT * FROM submissions WHERE campaign_id = ${c.id}`);
		const answers = submissions.length
			? q(`SELECT * FROM submission_answers WHERE submission_id IN (${submissions.map((s) => s.id).join(",")})`)
			: [];
		const files = submissions.length
			? q(`SELECT * FROM submission_files WHERE submission_id IN (${submissions.map((s) => s.id).join(",")})`)
			: [];
		dump.campaigns.push({ campaign: c, fields, submissions, answers, files });
		console.log(`ok    ${c.slug} — ${fields.length} fields, ${submissions.length} submissions, ${files.length} files`);
	}
	writeFileSync(file, JSON.stringify(dump));
	console.log(`→ ${file} (${dump.campaigns.length} campaign)`);
	process.exit(0);
}

// ── Fase import (jalankan di repo bph-cms) ─────────────────────────────────
if (cmd === "import") {
	if (!existsSync(file)) {
		console.error(`File ${file} tidak ada.`);
		process.exit(1);
	}
	const remote = rest.includes("--remote");
	const hubDir = new URL("..", import.meta.url).pathname;
	const dump = JSON.parse(readFileSync(file, "utf8"));
	if (!dump.campaigns?.length) {
		console.log("Tidak ada campaign untuk diimpor (dump kosong / semua reserved).");
		process.exit(0);
	}

	// 1. Cari division id advo.
	const [advo] = d1(hubDir, "bph-cms-db", `SELECT id FROM divisions WHERE slug = '${ADVO_DIVISION_SLUG}'`, remote);
	if (!advo) {
		console.error(`Divisi '${ADVO_DIVISION_SLUG}' tidak ditemukan di CMS Hub. Jalankan migrasi dulu.`);
		process.exit(1);
	}

	// 2. Cek bentrok slug di tujuan.
	const existing = d1(hubDir, "bph-cms-db", "SELECT slug FROM forms", remote).map((r) => r.slug);
	const now = new Date().toISOString();
	let totalForms = 0;
	let totalSubs = 0;

	for (const { campaign: c, fields, submissions, answers, files } of dump.campaigns) {
		if (existing.includes(c.slug)) {
			console.log(`skip  ${c.slug} — sudah ada di CMS Hub`);
			continue;
		}
		const formId = randomUUID();
		// ID baru utk semua baris supaya FK konsisten (advo pakai int autoincrement).
		const fieldMap = new Map(fields.map((f) => [f.id, randomUUID()]));
		const subMap = new Map(submissions.map((s) => [s.id, randomUUID()]));

		const stmts = [
			`INSERT INTO forms (id, division_id, slug, title, description, status, thank_you_message, opens_at, closes_at, created_by_user_id, updated_by_user_id, created_at, updated_at)
			 VALUES ('${formId}', '${advo.id}', '${esc(c.slug)}', '${esc(c.title)}', ${c.description ? `'${esc(c.description)}'` : "NULL"}, '${c.status}', '${esc(c.thankYouMessage ?? c.thank_you_message ?? "Terima kasih. Respons kamu sudah kami terima.")}', ${dt(c.opensAt ?? c.opens_at)}, ${dt(c.closesAt ?? c.closes_at)}, NULL, NULL, '${iso(c.createdAt ?? c.created_at)}', '${iso(c.updatedAt ?? c.updated_at)}')`,
			...fields.map(
				(f) => `INSERT INTO form_fields (id, form_id, label, description, type, required, options, sort_order, created_at, updated_at)
			 VALUES ('${fieldMap.get(f.id)}', '${formId}', '${esc(f.label)}', ${f.description ? `'${esc(f.description)}'` : "NULL"}, '${f.type}', ${f.required ? 1 : 0}, ${f.options ? `'${esc(f.options)}'` : "NULL"}, ${f.sortOrder ?? f.sort_order}, '${now}', '${now}')`,
			),
			...submissions.map(
				(s) => `INSERT INTO form_submissions (id, form_id, status, fingerprint, created_at, updated_at)
			 VALUES ('${subMap.get(s.id)}', '${formId}', '${s.status}', ${s.fingerprint ? `'${esc(String(s.fingerprint))}'` : "NULL"}, '${iso(s.createdAt ?? s.created_at)}', '${iso(s.updatedAt ?? s.updated_at)}')`,
			),
			...answers.map(
				(a) => `INSERT INTO form_answers (id, submission_id, field_id, field_label, field_type, value, created_at)
			 VALUES ('${randomUUID()}', '${subMap.get(a.submissionId ?? a.submission_id)}', ${a.fieldId ?? a.field_id ? `'${fieldMap.get(a.fieldId ?? a.field_id)}'` : "NULL"}, '${esc(a.fieldLabel ?? a.field_label)}', '${a.fieldType ?? a.field_type}', '${esc(a.value)}', '${iso(a.createdAt ?? a.created_at)}')`,
			),
			...files.map(
				(fl) => `INSERT INTO form_files (id, submission_id, field_id, storage_path, original_filename, mime_type, file_size, created_at)
			 VALUES ('${randomUUID()}', '${subMap.get(fl.submissionId ?? fl.submission_id)}', ${fl.fieldId ?? fl.field_id ? `'${fieldMap.get(fl.fieldId ?? fl.field_id)}'` : "NULL"}, '${esc(fl.storagePath ?? fl.storage_path)}', '${esc(fl.originalFilename ?? fl.original_filename)}', '${esc(fl.mimeType ?? fl.mime_type)}', ${fl.fileSize ?? fl.file_size}, '${iso(fl.createdAt ?? fl.created_at)}')`,
			),
		];

		// Wrangler --command satu statement; batch via file supaya aman.
		const tmp = `${file}.import-${c.slug}.sql`;
		writeFileSync(tmp, stmts.map((s) => s.replace(/\s+/g, " ").replace(/;$/, "") + ";").join("\n"));
		execFileSync("npx", ["wrangler", "d1", "execute", "bph-cms-db", remote ? "--remote" : "--local", "--file", tmp], {
			cwd: hubDir,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		rmSync(tmp, { force: true });
		totalForms++;
		totalSubs += submissions.length;
		console.log(`ok    ${c.slug} — ${fields.length} fields, ${submissions.length} submissions, ${files.length} files`);
	}
	console.log(`Selesai: ${totalForms} form, ${totalSubs} respons dimigrasi ke divisi ${ADVO_DIVISION_SLUG}.`);
	process.exit(0);
}

usage();

// ── helpers ─────────────────────────────────────────────────────────────────
function esc(v) {
	return String(v ?? "").replace(/'/g, "''");
}
function iso(v) {
	// D1 advo simpan ISO string; kalau number (epoch ms) konversi.
	if (v == null) return new Date().toISOString();
	return typeof v === "number" ? new Date(v).toISOString() : String(v);
}
function dt(v) {
	return v == null ? "NULL" : `'${iso(v)}'`;
}
