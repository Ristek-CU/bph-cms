-- Field aktif/nonaktif di form publik — paritas dengan Form Builder AdvocationDashboard.
ALTER TABLE form_fields ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
