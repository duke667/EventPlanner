ALTER TABLE "event_invitations"
  ADD COLUMN "access_code" TEXT;

CREATE UNIQUE INDEX "event_invitations_access_code_key"
  ON "event_invitations"("access_code");
