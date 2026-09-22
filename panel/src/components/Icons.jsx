import React from "react";

export function IconGrid({ className = "icon-svg", size = 18 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<rect width="7" height="7" x="3" y="3" rx="1" />
			<rect width="7" height="7" x="14" y="3" rx="1" />
			<rect width="7" height="7" x="14" y="14" rx="1" />
			<rect width="7" height="7" x="3" y="14" rx="1" />
		</svg>
	);
}

export function IconCalendar({ className = "icon-svg", size = 18 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M8 2v4" />
			<path d="M16 2v4" />
			<rect width="18" height="18" x="3" y="4" rx="2" />
			<path d="M3 10h18" />
		</svg>
	);
}

export function IconClipboard({ className = "icon-svg", size = 18 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
			<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
			<path d="M9 12h6" />
			<path d="M9 16h6" />
		</svg>
	);
}

export function IconLink({ className = "icon-svg", size = 18 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
			<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
		</svg>
	);
}

export function IconClock({ className = "icon-svg", size = 14 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<circle cx="12" cy="12" r="10" />
			<polyline points="12 6 12 12 16 14" />
		</svg>
	);
}

export function IconMapPin({ className = "icon-svg", size = 14 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
			<circle cx="12" cy="10" r="3" />
		</svg>
	);
}

export function IconUsers({ className = "icon-svg", size = 14 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
			<circle cx="9" cy="7" r="4" />
			<path d="M22 21v-2a4 4 0 0 0-3-3.87" />
			<path d="M16 3.13a4 4 0 0 1 0 7.75" />
		</svg>
	);
}

export function IconTicket({ className = "icon-svg", size = 14 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
			<path d="M13 5v2" />
			<path d="M13 17v2" />
			<path d="M13 11v2" />
		</svg>
	);
}

export function IconMenu({ className = "icon-svg", size = 18 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<line x1="4" x2="20" y1="12" y2="12" />
			<line x1="4" x2="20" y1="6" y2="6" />
			<line x1="4" x2="20" y1="18" y2="18" />
		</svg>
	);
}

export function IconPlus({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M5 12h14" />
			<path d="M12 5v14" />
		</svg>
	);
}

export function IconEye({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	);
}

export function IconEyeOff({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M10.7 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.1 4M6.6 6.6A17.3 17.3 0 0 0 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.4" />
			<path d="m2 2 20 20" />
			<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
		</svg>
	);
}

export function IconPencil({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
			<path d="m15 5 4 4" />
		</svg>
	);
}

export function IconTrash({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M3 6h18" />
			<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
			<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
			<line x1="10" x2="10" y1="11" y2="17" />
			<line x1="14" x2="14" y1="11" y2="17" />
		</svg>
	);
}

export function IconGrip({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" className={className}>
			<circle cx="9" cy="5" r="1" />
			<circle cx="9" cy="12" r="1" />
			<circle cx="9" cy="19" r="1" />
			<circle cx="15" cy="5" r="1" />
			<circle cx="15" cy="12" r="1" />
			<circle cx="15" cy="19" r="1" />
		</svg>
	);
}

export function IconCheck({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M20 6 9 17l-5-5" />
		</svg>
	);
}

export function IconQrCode({ className = "icon-svg", size = 18 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<rect width="5" height="5" x="3" y="3" />
			<rect width="5" height="5" x="16" y="3" />
			<rect width="5" height="5" x="3" y="16" />
			<path d="M21 11h-3" />
			<path d="M21 15h-3" />
			<path d="M21 19h-3" />
			<path d="M14 13v6" />
			<path d="M14 11v-1" />
			<path d="M11 14h1" />
			<path d="M11 19h1" />
		</svg>
	);
}

export function IconDownload({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<line x1="12" x2="12" y1="15" y2="3" />
		</svg>
	);
}

export function IconExternalLink({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M15 3h6v6" />
			<path d="M10 14 21 3" />
			<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
		</svg>
	);
}

export function IconBarChart({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<line x1="12" x2="12" y1="20" y2="10" />
			<line x1="18" x2="18" y1="20" y2="4" />
			<line x1="6" x2="6" y1="20" y2="16" />
		</svg>
	);
}

export function IconPieChart({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
			<path d="M22 12A10 10 0 0 0 12 2v10z" />
		</svg>
	);
}

export function IconTrendingUp({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
			<polyline points="16 7 22 7 22 13" />
		</svg>
	);
}

export function IconChevronLeft({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="m15 18-6-6 6-6" />
		</svg>
	);
}

export function IconChevronRight({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="m9 18 6-6-6-6" />
		</svg>
	);
}

// ---- Ikon tipe pertanyaan (ala Google Forms type picker) ----
export function IconTypeText({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<polyline points="4 7 4 4 20 4 20 7" />
			<line x1="9" x2="15" y1="20" y2="20" />
			<line x1="12" x2="12" y1="4" y2="20" />
		</svg>
	);
}
export function IconTypeParagraph({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<line x1="3" x2="21" y1="6" y2="6" />
			<line x1="3" x2="21" y1="12" y2="12" />
			<line x1="3" x2="15" y1="18" y2="18" />
		</svg>
	);
}
export function IconTypeEmail({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<rect width="20" height="16" x="2" y="4" rx="2" />
			<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
		</svg>
	);
}
export function IconTypeNumber({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M4 9c0-2.5 2.5-3 4-1l4 8c1.5 2 4 1.5 4-1" />
			<line x1="3" x2="7" y1="13" y2="13" />
			<line x1="17" x2="21" y1="13" y2="13" />
		</svg>
	);
}
export function IconTypeChoice({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<circle cx="12" cy="12" r="9" />
			<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
		</svg>
	);
}
export function IconTypeCheckboxes({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<rect width="7" height="7" x="3" y="5" rx="1.5" />
			<path d="m5 8.5 1.5 1.5L9 7" />
			<rect width="7" height="7" x="3" y="15" rx="1.5" />
			<path d="m5 18.5 1.5 1.5L9 17" />
			<line x1="13" x2="21" y1="8.5" y2="8.5" />
			<line x1="13" x2="21" y1="18.5" y2="18.5" />
		</svg>
	);
}
export function IconTypeDropdown({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<polyline points="6 9 12 15 18 9" />
		</svg>
	);
}
export function IconTypeScale({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<line x1="3" x2="21" y1="12" y2="12" />
			<circle cx="5" cy="12" r="2" fill="currentColor" stroke="none" />
			<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
			<circle cx="19" cy="12" r="2" fill="currentColor" stroke="none" />
		</svg>
	);
}
export function IconTypeDate({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<rect width="18" height="18" x="3" y="4" rx="2" />
			<line x1="16" x2="16" y1="2" y2="6" />
			<line x1="8" x2="8" y1="2" y2="6" />
			<line x1="3" x2="21" y1="10" y2="10" />
			<rect width="3" height="3" x="7" y="13" rx="0.5" fill="currentColor" stroke="none" />
		</svg>
	);
}
export function IconTypeFile({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="17 8 12 3 7 8" />
			<line x1="12" x2="12" y1="3" y2="15" />
		</svg>
	);
}
export function IconCopy({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<rect width="14" height="14" x="8" y="8" rx="2" />
			<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
		</svg>
	);
}

export function IconShare({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<circle cx="18" cy="5" r="3" />
			<circle cx="6" cy="12" r="3" />
			<circle cx="18" cy="19" r="3" />
			<line x1="8.59" x2="15.42" y1="13.51" y2="16.49" />
			<line x1="15.41" x2="8.59" y1="10.51" y2="7.49" />
		</svg>
	);
}

export function IconWhatsapp({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
			<path d="M17.472 14.556c-.301-.15-1.767-.87-2.04-.969-.273-.1-.471-.15-.67.15-.198.3-.771.968-.944 1.168-.173.2-.346.223-.646.074-.301-.149-1.274-.47-2.426-1.495-.896-.8-1.5-1.787-1.677-2.088-.174-.301-.018-.463.132-.613.134-.134.3-.348.449-.523.149-.174.198-.298.298-.497.1-.199.05-.374-.025-.523-.075-.149-.67-1.611-.917-2.208-.242-.584-.488-.502-.67-.51-.173-.007-.371-.01-.57-.01-.198 0-.522.074-.796.374-.273.3-1.045 1.021-1.045 2.488 0 1.468 1.073 2.884 1.223 3.082.149.199 2.096 3.2 5.08 4.487.706.304 1.257.486 1.687.621.71.226 1.34.194 1.844.12.565-.084 1.767-.722 2.016-1.42.249-.699.249-1.297.174-1.42-.075-.124-.273-.198-.572-.348zM12.003 2C6.478 2 2.003 6.475 2.003 12c0 1.89.525 3.66 1.433 5.19L2.003 22l4.945-1.403A9.934 9.934 0 0 0 12.003 22c5.523 0 10-4.477 10-10s-4.477-10-10-10z" />
		</svg>
	);
}

export function IconDuplicate({ className = "icon-svg", size = 16 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<rect width="14" height="14" x="8" y="8" rx="2" />
			<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
		</svg>
	);
}
