-- Migration 024: Set REPLICA IDENTITY FULL on blocks table
-- ==============================================
-- Por defecto PostgreSQL usa REPLICA IDENTITY DEFAULT, lo que significa que
-- payload.old en eventos DELETE solo contiene la primary key (id).
-- Esto impide que los handlers Realtime lean blocker_id y blocked_id
-- cuando ocurre un desbloqueo, causando que el cache no se actualice.
--
-- Con REPLICA IDENTITY FULL, payload.old contendrá TODAS las columnas,
-- permitiendo a los handlers DELETE funcionar igual que los INSERT.
-- ==============================================

ALTER TABLE blocks REPLICA IDENTITY FULL;
