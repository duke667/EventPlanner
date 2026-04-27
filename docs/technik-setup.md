# Technik-Setup EventManager

## 1. Zielarchitektur

Fuer den beschriebenen Use Case ist eine klassische Web-Architektur mit getrenntem Frontend und Backend sinnvoll.

Empfehlung fuer den Start:

- Frontend: Next.js
- Backend: NestJS
- Datenbank: PostgreSQL
- ORM: Prisma
- Hintergrundjobs: aktuell einfache Datenbank-Mailqueue; spaeter BullMQ mit Redis
- Dateispeicher: lokal in Dev, S3-kompatibel in Produktion
- Mailversand: Postmark, Mailgun oder SendGrid
- Authentifizierung: aktuell JWT Bearer Token; spaeter HttpOnly Cookies pruefen
- Deployment: Docker-Container

Warum dieses Setup:

- TypeScript ueber den gesamten Stack reduziert Reibung.
- Next.js deckt Backoffice, mobile Check-in-Seiten und Gastseiten sauber ab.
- NestJS ist fuer modulare Business-Logik, Validierung und Jobs gut geeignet.
- PostgreSQL passt sehr gut fuer relationale Prozesse wie Kontakte, Einladungen und Statushistorie.
- Prisma beschleunigt Datenmodellierung und Migrationen.

## 2. Empfohlener Stack im Detail

### Frontend

- `Next.js` mit App Router
- `TypeScript`
- CSS im App Router ueber `globals.css`
- Backoffice, Gastseiten und mobile Check-in-Ansichten in einer Next.js-App
- QR-Scanner im Browser aktuell ueber native `BarcodeDetector` API mit manueller Token-Fallback-Eingabe

### Backend

- `NestJS`
- `Prisma`
- `Zod` oder `class-validator` fuer API-Validierung
- Datenbankbasierte Mailjobs fuer Einladungen und Bestaetigungen
- `BullMQ` bleibt Option fuer spaetere Reminder und robuste Worker-Skalierung
- `nodemailer` nur fuer lokale Entwicklung; in Produktion API-basierter Mailprovider
- `ical-generator` oder aehnliche Library fuer ICS-Dateien
- `xlsx` fuer Excel-Import
- `csv-parse` fuer CSV-Import
- `qrcode` fuer QR-Code-Erzeugung

### Infrastruktur

- `PostgreSQL`
- `Redis`
- `MinIO` optional fuer lokale S3-nahe Dateiverwaltung
- `Docker Compose` fuer lokale Entwicklung
- Reverse Proxy spaeter z. B. `Traefik` oder `Nginx`

## 3. Monorepo-Empfehlung

Ich empfehle ein Monorepo, damit Frontend, Backend und geteilte Typen zusammen entwickelt werden.

Vorschlag:

```text
EventManager/
  apps/
    web/          # Next.js Backoffice + Gastseiten + Check-in UI
    api/          # NestJS API + Jobs + Maillogik
  packages/
    config/       # shared tsconfig, eslint, prettier
    ui/           # optionale shared UI-Komponenten
    types/        # gemeinsame DTOs, Zod-Schemas, Konstanten
  infra/
    docker/       # Dockerfiles, compose, env-Beispiele
  docs/
  .env.example
  package.json
  turbo.json
```

Aktueller Projektstand:

- Monorepo mit `npm workspaces`
- bewusst ohne Turborepo, damit das Geruest auf der vorhandenen Notebook-Umgebung direkt lauffaehig bleibt

Spaeter kann ohne grossen Umbau auf `pnpm` und `Turborepo` migriert werden, wenn die lokale Toolchain vereinheitlicht ist.

## 4. Datenbank-Startmodell

Fuer den MVP reichen zunaechst diese Tabellen:

### `users`

- `id`
- `email`
- `password_hash`
- `first_name`
- `last_name`
- `role`
- `created_at`
- `updated_at`

Aktuelle Rollen: `ADMIN`, `EVENT_PLANNER`, `STAFF` als Legacy-Planungsrolle und `CHECK_IN`.
Die Selbstregistrierung ist vorerst offen; spaeter sollte ein Admin neue Benutzer freischalten und Rollen vergeben.

### `contacts`

- `id`
- `salutation`
- `first_name`
- `last_name`
- `email`
- `phone`
- `company`
- `job_title`
- `street`
- `postal_code`
- `city`
- `country`
- `tags`
- `notes`
- `created_at`
- `updated_at`

### `contact_imports`

- `id`
- `uploaded_by_user_id`
- `filename`
- `source_type`
- `status`
- `total_rows`
- `imported_rows`
- `error_rows`
- `mapping_json`
- `error_log_json`
- `created_at`

### `events`

- `id`
- `title`
- `slug`
- `description`
- `guest_page_title`
- `guest_page_intro`
- `guest_page_info`
- `guest_accept_label`
- `guest_decline_label`
- `location_name`
- `location_address`
- `starts_at`
- `ends_at`
- `timezone`
- `capacity`
- `allow_companion`
- `status`
- `created_by_user_id`
- `created_at`
- `updated_at`

### `event_invitations`

- `id`
- `event_id`
- `contact_id`
- `status`
- `access_code`
- `invite_token_hash`
- `checkin_token_hash`
- `invited_at`
- `opened_at`
- `responded_at`
- `created_at`
- `updated_at`

### `event_registrations`

- `id`
- `event_invitation_id`
- `response`
- `guest_count`
- `comment`
- `dietary_requirements`
- `companion_requested`
- `companion_first_name`
- `companion_last_name`
- `registered_at`
- `cancelled_at`

### `check_ins`

- `id`
- `event_invitation_id`
- `method`
- `checked_in_at`
- `checked_in_by_user_id`
- `device_info`
- `companion_present`

### `email_jobs`

- `id`
- `event_id`
- `event_invitation_id`
- `template_type`
- `provider_message_id`
- `status`
- `sent_at`
- `error_message`

## 5. API-Schnittstellen fuer den MVP

### Mitarbeiterbereich

- `POST /auth/login`
- `POST /auth/logout`
- `GET /contacts`
- `POST /contacts`
- `PATCH /contacts/:id`
- `POST /contacts/import`
- `GET /events`
- `POST /events`
- `GET /events/:id`
- `PATCH /events/:id`
- `POST /events/:id/invitations`
- `POST /events/:id/import-guests`
- `POST /events/:id/send-invitations`
- `GET /events/:id/attendees`
- `POST /events/:id/check-in/preview`
- `POST /events/:id/check-in`

### Gastbereich

- `GET /guest/invitation/:token`
- `POST /guest/invitation/:token/respond`
- `GET /guest/invitation/:token/ics`

## 6. Technische Prozessabbildung

### Kontaktimport

1. Datei-Upload in Web-App.
2. Backend liest CSV oder XLSX direkt aus dem Upload-Buffer.
3. Import validiert Datensaetze, schreibt Kontakte und protokolliert Fehler.
4. Beim eventbezogenen Gaestelistenimport werden Kontakte direkt dem Event als Einladungen zugeordnet.
5. Stadtgeburtstag-spezifische Spalten werden auf Kontaktfelder und Serienbrief-Metadaten gemappt.

### Einladungsmail

1. Mitarbeiter startet Versand.
2. Mitarbeiter kann Betreff und Text mit Platzhaltern erfassen.
3. Backend erzeugt pro Einladung einen Mailjob.
4. Worker rendert E-Mail-Template mit Kontakt-, Event- und Importfeldern und verschickt ueber SMTP/Provider.
5. Versandstatus wird gespeichert.

### Registrierung

1. Gast klickt auf personalisierten Link.
2. Token wird geprueft.
3. Formular wird angezeigt.
4. Antwort wird gespeichert.
5. Falls das Event Begleitung erlaubt, kann der Gast eine Begleitperson angeben.
6. Bestaetigungsmail mit ICS wird als Job versendet.

### Check-in

1. Mitarbeiter oeffnet mobile Liste oder Scanneransicht.
2. Suche oder QR-Code identifiziert Einladung.
3. Bei QR-Scan liefert `/events/:id/check-in/preview` zunaechst die Gastdaten inklusive Begleitstatus.
4. Mitarbeiter bestaetigt den Check-in und ggf. die Anwesenheit der Begleitung.
5. Backend validiert Event und Status.
6. Check-in wird geschrieben und UI aktualisiert.

### Live-Dashboard

1. Backoffice laedt `/events/:id/attendees`.
2. Frontend berechnet daraus Live-Kennzahlen pro Event.
3. Kennzahlen umfassen Einladungen, Zusagen, Absagen, offene Antworten, erwartete Personen, Personen vor Ort, Begleitungen, Einlassquote und Kapazitaetsauslastung.
4. Listen fuer noch nicht eingecheckte Zusagen und letzte Check-ins werden clientseitig aus derselben Datenbasis berechnet.

## 7. Lokales Entwicklungs-Setup

### Voraussetzungen

- `git`
- `nodejs` >= 18.19
- `npm` >= 9
- `docker`
- `docker-compose`

### Lokale Dienste

Per `docker-compose`:

- PostgreSQL
- Redis
- Mailpit fuer lokale Mailtests
- optional MinIO

### Lokale Entwicklung

- `apps/web` laeuft lokal auf Port 3000
- `apps/api` laeuft lokal auf Port 4000
- Prisma-Migrationen laufen gegen lokale PostgreSQL-Instanz
- Mailversand geht lokal an Mailpit statt an echte Empfaenger

## 8. Deployment-Strategie

Fuer den Anfang empfehle ich einen containerisierten Deploy auf einem Linux-Server oder einer VM.

Setup Produktion:

- `web` Container
- `api` Container
- `worker` Container fuer Jobs
- `postgres` als Managed DB oder separater Dienst
- `redis`
- Reverse Proxy mit TLS
- externer Mailprovider
- S3-kompatibler Storage fuer Importdateien und Exporte

Deployment-Ablauf:

1. Entwicklung lokal auf dem Notebook
2. Push in Git-Repository
3. CI baut Images und testet
4. Zielsystem zieht neue Images und startet Container neu

## 9. Sicherheits-Setup

- getrennte Secrets pro Umgebung
- `.env.example` ohne echte Schluessel
- Passwort-Hashing mit `argon2`
- Rate Limits auf Gast-Endpoints
- Audit-Logs fuer sensible Aenderungen
- serverseitige Validierung fuer alle Imports und Formulare
- signierte Tokens statt fortlaufender IDs in oeffentlichen Links

## 10. Empfohlene Umsetzungsreihenfolge

### Phase 1: Grundsystem

- Monorepo anlegen
- Frontend- und Backend-Projekte erzeugen
- Docker-Compose fuer Postgres, Redis, Mailpit
- Auth fuer Mitarbeiter
- Prisma-Datenmodell und erste Migrationen

### Phase 2: Kontakte und Events

- Kontaktverwaltung
- Kontakte bearbeiten und loeschen
- CSV/XLSX-Import
- Eventverwaltung
- Einladungslisten

### Phase 3: Einladung und Registrierung

- Mailtemplates
- Versandpipeline
- Gastregistrierung per Token-Link oder kurzem Einladungscode
- Bestaetigungsmail mit ICS

### Phase 4: Eventtag

- mobile Teilnehmerliste
- manueller Check-in
- QR-Code-Check-in

### Phase 5: Härtung

- Tests
- Rollenmodell
- Monitoring
- Backup- und Restore-Konzept

## 11. Konkrete Empfehlung

Wenn du schnell und sauber starten willst, ist diese Kombination fuer dein Projekt am sinnvollsten:

- `Next.js` fuer Web-Frontend
- `NestJS` fuer API und Hintergrundjobs
- `PostgreSQL` als Datenbank
- `Prisma` als ORM
- `Redis + BullMQ` fuer asynchrone Jobs
- `npm workspaces` fuer den lokalen Monorepo-Start
- `docker-compose` fuer lokale Entwicklung
- `Mailpit` lokal und `Postmark` in Produktion

Damit koennen wir im naechsten Schritt direkt das technische Grundgeruest erzeugen.
