-- 077: Canciones compartidas en el chat
--
-- Guarda la canción como jsonb (shape normalizado de services/musicService:
-- provider, trackId, title, artist, album, artwork, previewUrl, externalUrl,
-- duration) para pintar la tarjeta en el mensaje sin depender de una tabla
-- aparte: el stream completo se resuelve con innertube a partir de
-- artista + título (api/_innertube.js), igual que en la card del perfil.
--
-- Sin índice: la canción se lee junto al mensaje (`select *`), nunca se
-- consulta por este campo.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS shared_song JSONB;

-- El contrato es un objeto plano (o NULL). Evita arrays/escalares sueltos que
-- romperían el render de la tarjeta.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_shared_song_object;
ALTER TABLE messages ADD CONSTRAINT messages_shared_song_object
  CHECK (shared_song IS NULL OR jsonb_typeof(shared_song) = 'object');
