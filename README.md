# EventManager

Event-Management-Tool fuer interne Mitarbeiter zur Planung, Einladung, Anmeldung und Check-in von Gaesten.

## Aktueller Funktionsstand

- Backoffice mit Login, Rollenlogik und getrennten Bereichen fuer Uebersicht, Kontakte, Events, Einladungen, Live-Dashboard und Check-in
- offene Registrierung mit Rollenauswahl fuer Admin, Event Planer und Check-in
- Kontaktverwaltung mit manuellem Anlegen, Bearbeiten, Loeschen und CSV/XLSX-Import
- Event-Erstellung inklusive Kapazitaet, Status und Option "Begleitung erlaubt"
- Gastseiten-Vorlage je Event mit eigenem Seitentitel, Einleitung, Zusatzinformation und Antworttexten
- Gaestelistenimport direkt fuer ein Event aus CSV/XLSX, inklusive spezieller Excel-Spalten fuer Anrede und Serienbrief-Felder
- Einladungslisten pro Event aus Kontakten oder importierter Gaesteliste
- frei editierbarer Einladungstext mit Platzhaltern wie `{{contact.personalSalutation}}`, `{{event.title}}`, `{{custom.amt}}`, `{{invitationUrl}}` und `{{invitationCode}}`
- Mail-Queue fuer Einladungen und Bestaetigungen, lokal testbar ueber Mailpit
- Gastseite per persoenlichem Link oder kurzem Einladungscode fuer Zusage oder Absage, optional mit Begleitperson inklusive Vor- und Nachname
- QR-Code und manueller Check-in
- Check-in-Vorschau bei QR-Scan mit Bestaetigung, ob eine angemeldete Begleitung tatsaechlich dabei ist
- Live-Dashboard pro Veranstaltung mit eingeladenen, zugesagten, offenen, abgesagten und eingecheckten Gaesten sowie Personen vor Ort inklusive Begleitungen

## Zielbild

Das System soll folgende Prozesse abdecken:

1. Mitarbeiter pflegen Kontakte manuell oder per Datei-Import.
2. Mitarbeiter legen Events an und erstellen daraus Einladungslisten.
3. Eingeladene Gaeste erhalten eine E-Mail mit personalisiertem Link und kurzem Einladungscode zur Anmeldung.
4. Nach erfolgreicher Anmeldung erhalten Gaeste eine Bestaetigung inklusive ICS-Kalendereintrag und QR-Code.
5. Am Eventtag koennen Mitarbeiter auf mobilen Geraeten den Einlass dokumentieren.
6. Der QR-Code aus der Bestaetigung kann am Einlass gescannt werden.
7. Veranstaltungsmanager sehen live, wie viele Personen erwartet werden und bereits vor Ort sind.

## Dokumente

- [Produktkonzept](./docs/produktkonzept.md)
- [Technik-Setup](./docs/technik-setup.md)
- [Deployment Testsystem](./docs/deployment-testsystem.md)

## Projektstruktur

```text
apps/
  web/       Next.js Frontend fuer Backoffice und Gastseiten
  api/       NestJS API inklusive Prisma-Grundmodell
packages/
  types/     gemeinsame Typen
infra/
  docker/    Hinweise zur lokalen Infrastruktur
```

## Lokaler Start

Voraussetzungen:

- Node.js 18.19+ oder 20+
- npm 9+
- Docker
- docker-compose

Start:

```bash
cp .env.example .env
docker-compose up -d
npm install
npm run db:generate
npm run db:migrate -- --name init
npm run seed
npm run dev:api
npm run dev:web
```

Frontend:

- `http://localhost:3000`

API:

- `http://localhost:4000/api/health`

Mailpit:

- `http://localhost:8025`

Lokaler Admin-Seed:

- E-Mail `admin@example.com`
- Passwort `ChangeMe123!`
- nur fuer lokale Entwicklung, direkt aendern sobald wir Benutzerverwaltung/UI haben

## Naechster Schritt

Der aktuelle Stand ist bereit fuer einen Testsystem-Smoke-Test mit realistischem Ablauf: Event anlegen, Gaesteliste importieren, Einladungstext mit Platzhaltern vorbereiten, Mailversand ueber Mailpit pruefen, Gastantwort mit/ohne Begleitung testen, QR-Check-in ausfuehren und Live-Dashboard kontrollieren.

## Testsystem-Deployment

Fuer das Testsystem gibt es jetzt:

- Compose-Setup in [docker-compose.testsystem.yml](./docker-compose.testsystem.yml)
- Env-Vorlage in [.env.test.example](./.env.test.example)
- Dockerfiles fuer [apps/api](./apps/api/Dockerfile) und [apps/web](./apps/web/Dockerfile)
- Deploy-Anleitung in [docs/deployment-testsystem.md](./docs/deployment-testsystem.md)

Schnellstart:

```bash
cp .env.test.example .env.test
docker-compose -f docker-compose.testsystem.yml --env-file .env.test up -d --build
docker-compose -f docker-compose.testsystem.yml --env-file .env.test --profile tools run --rm seed-admin
```
