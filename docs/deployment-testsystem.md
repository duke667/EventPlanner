# Deployment Testsystem

Diese Anleitung bringt den aktuellen Stand auf ein internes Testsystem mit Docker Compose.

## Zielbild

Das Testsystem besteht aus:

- `web` fuer Backoffice und Gastseiten
- `api` fuer Auth, Kontakte, Events, Einladungen und Check-in
- `postgres` als Datenbank
- `redis` fuer Queue-/State-Basis
- `mailpit` fuer SMTP-Tests und Mail-UI

## Voraussetzungen

- Linux-Server oder VM mit Docker Engine und Docker Compose Plugin
- Git-Zugriff auf dieses Repository
- erreichbare Hostnamen oder IP fuer Web/API
- offene Ports fuer Web, API und optional Mailpit

## Dateien

- Compose: [docker-compose.testsystem.yml](/home/sascha/Projects/EventManager/docker-compose.testsystem.yml)
- Env-Vorlage: [.env.test.example](/home/sascha/Projects/EventManager/.env.test.example)
- API-Image: [apps/api/Dockerfile](/home/sascha/Projects/EventManager/apps/api/Dockerfile)
- Web-Image: [apps/web/Dockerfile](/home/sascha/Projects/EventManager/apps/web/Dockerfile)

## Vorbereitung

1. Repository auf das Testsystem klonen.
2. `.env.test.example` nach `.env.test` kopieren.
3. Alle Secrets und URLs in `.env.test` anpassen.

Empfohlene Mindestanpassungen:

- `NEXT_PUBLIC_APP_URL=https://events-test.example.com`
- `NEXT_PUBLIC_API_URL=https://api.events-test.example.com`
- `POSTGRES_PASSWORD` mit starkem Passwort setzen
- `JWT_SECRET` und `INVITE_TOKEN_SECRET` mit langen Zufallswerten setzen
- `SEED_ADMIN_PASSWORD` mit starkem Startpasswort setzen

## Start

Build und Start:

```bash
docker-compose -f docker-compose.testsystem.yml --env-file .env.test up -d --build
```

Admin initial anlegen oder aktualisieren:

```bash
docker-compose -f docker-compose.testsystem.yml --env-file .env.test --profile tools run --rm seed-admin
```

Status pruefen:

```bash
docker-compose -f docker-compose.testsystem.yml --env-file .env.test ps
docker-compose -f docker-compose.testsystem.yml --env-file .env.test logs api --tail 100
docker-compose -f docker-compose.testsystem.yml --env-file .env.test logs web --tail 100
```

## Erster Test

Nach dem Start pruefen:

- Frontend: `http://SERVER:3000` oder deine Test-Domain
- API-Health: `http://SERVER:4000/api/health`
- Mailpit: `http://SERVER:8025`

Dann mit dem Seed-Admin anmelden und einen kurzen Smoke-Test fahren:

1. Login im Backoffice
2. Event anlegen und entscheiden, ob Begleitung erlaubt ist
3. Kontakt importieren/manuell anlegen oder im Bereich Einladungen eine Gaesteliste direkt fuer das Event importieren
4. Einladungstext mit Serienbrief-Platzhaltern pruefen, z. B. `{{contact.personalSalutation}}`, `{{event.title}}`, `{{custom.amt}}`, `{{invitationUrl}}`
5. Einladung erzeugen bzw. importierte Gaesteliste pruefen und Versand anstossen
6. Mail in Mailpit oeffnen und Gastlink testen
7. Zusage ohne Begleitung und, falls erlaubt, Zusage mit Begleitperson testen
8. Bestaetigung und ICS pruefen
9. QR-Check-in pruefen: erst Vorschau, dann Check-in bestaetigen und ggf. "Begleitung ist dabei" setzen
10. Live-Dashboard pruefen: eingeladene, zugesagte, offene, abgesagte und eingecheckte Gaeste sowie Personen vor Ort inklusive Begleitungen

## Reverse Proxy

Fuer ein sauberes Testsetup sollten `web` und `api` spaeter hinter einem Reverse Proxy mit TLS laufen.

Aktuelle Annahme im Frontend:

- der Browser spricht nur den Web-Container an
- der Web-Container proxyt Requests intern auf die API
- `API_INTERNAL_URL` ist die intern erreichbare API-Adresse fuer den Web-Container
- `NEXT_PUBLIC_API_URL` bleibt fuer direkte API-Links und Dokumentation relevant

Das bedeutet:

- intern im Compose-Setup: `API_INTERNAL_URL=http://api:4000`
- extern fuer direkte API-Aufrufe oder spaeteren Proxy: `NEXT_PUBLIC_API_URL=https://api.events-test.example.com`
- falsch: `NEXT_PUBLIC_API_URL=https://api.events-test.example.com/api`

## Admin-Seed

Der Seed ist fuer das Testsystem env-gesteuert:

- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`
- `SEED_ADMIN_FIRST_NAME`
- `SEED_ADMIN_LAST_NAME`

Wichtig:

- in `production` ist `SEED_ADMIN_PASSWORD` Pflicht
- der Seed macht ein `upsert` auf die E-Mail
- damit kann der Admin sauber aktualisiert werden, ohne die Datenbank zu leeren
- der Seed-Container generiert vor dem Lauf seinen Prisma-Client selbst

## Update-Deploy

Bei neuen Commits:

```bash
git pull
docker-compose -f docker-compose.testsystem.yml --env-file .env.test up -d --build
```

Nach dem Deploy fuer diesen Stand besonders pruefen:

- `/backoffice/live` ist erreichbar und in der Navigation sichtbar.
- Eventbeschreibung wird normal angezeigt und enthaelt keine internen Metadaten.
- Gaeste koennen Begleitpersonen nur anmelden, wenn das Event diese Option erlaubt.
- QR-Check-in zeigt vor dem finalen Check-in eine Vorschau.
- Personenzaehlung im Live-Dashboard beruecksichtigt bestaetigte Begleitungen.

Falls sich das Admin-Passwort aendert:

```bash
docker-compose -f docker-compose.testsystem.yml --env-file .env.test --profile tools run --rm seed-admin
```

## Noch bewusst offen

Vor dem produktiven Einsatz fehlen weiterhin:

- Reverse Proxy mit TLS
- Rollen/Feingranularitaet im UI
- automatisierte Tests und CI
- Monitoring/Backups
- echte Mail-Infrastruktur statt Mailpit
- produktionsreife Datenbankspalten fuer Begleitpersonen und Event-Optionen statt der aktuellen migrationsfreien Metadatenablage
