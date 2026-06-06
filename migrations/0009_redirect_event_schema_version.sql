-- Default must match `REDIRECT_EVENT_SCHEMA_VERSION` in
-- `src/server/db/redirect-event-schema-version.ts` at the time this migration shipped.
ALTER TABLE `redirect_event` ADD `event_schema_version` integer NOT NULL DEFAULT 1;
