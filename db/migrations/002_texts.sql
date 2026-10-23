-- Ajuste de textos iniciales (la base ya estaba sembrada).
UPDATE users SET name = 'Administrador'
 WHERE upper(code) = 'ADM-001' AND name ILIKE 'Administrador demo';
UPDATE history SET detail = 'Catálogos y perfiles iniciales cargados.'
 WHERE detail ILIKE '%ejemplo cargados%' OR detail ILIKE '%demostraci%';
