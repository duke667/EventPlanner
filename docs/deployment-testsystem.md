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
2. Kontakt importieren oder manuell anlegen
3. Event anlegen
4. Einladung erzeugen und Versand anstossen
5. Gastlink aus Mailpit testen
6. Zusage und ICS pruefen
7. Check-in manuell und per QR pruefen

## Reverse Proxy

Fuer ein sauberes Testsetup sollten `web` und `api` spaeter hinter einem Reverse Proxy mit TLS laufen.

Aktuelle Annahme im Frontend:

- `NEXT_PUBLIC_API_URL` zeigt auf die Basis-URL der API
- die Anwendung haengt selbst `/api` an Requests an

Das bedeutet:

- richtig: `https://api.events-test.example.com`
- falsch: `https://api.events-test.example.com/api`

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

## Update-Deploy

Bei neuen Commits:

```bash
git pull
docker-compose -f docker-compose.testsystem.yml --env-file .env.test up -d --build
```

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
