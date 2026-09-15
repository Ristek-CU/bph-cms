-- Warna background halaman form publik — dikontrol admin dari panel,
-- dirender landing page. Default netral krem selaras landing page (#F6F4EF).
ALTER TABLE forms ADD COLUMN background_color TEXT NOT NULL DEFAULT '#F6F4EF';
