ALTER TABLE "events"
  ADD COLUMN "allow_companion" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "event_registrations"
  ADD COLUMN "companion_requested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "companion_first_name" TEXT,
  ADD COLUMN "companion_last_name" TEXT;

ALTER TABLE "check_ins"
  ADD COLUMN "companion_present" BOOLEAN NOT NULL DEFAULT false;
