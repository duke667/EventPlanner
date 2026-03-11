# EventManager

Event-Management-Tool fuer interne Mitarbeiter zur Planung, Einladung, Anmeldung und Check-in von Gaesten.

## Zielbild

Das System soll folgende Prozesse abdecken:

1. Mitarbeiter pflegen Kontakte manuell oder per Datei-Import.
2. Mitarbeiter legen Events an und erstellen daraus Einladungslisten.
3. Eingeladene Gaeste erhalten eine E-Mail mit personalisiertem Link zur Anmeldung.
4. Nach erfolgreicher Anmeldung erhalten Gaeste eine Bestaetigung inklusive ICS-Kalendereintrag.
5. Am Eventtag koennen Mitarbeiter auf mobilen Geraeten den Einlass dokumentieren.
6. Optional kann ein QR-Code aus der Einladung gescannt werden, um den Check-in zu beschleunigen.

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

Die fachliche Kernkette ist lokal vorhanden. Der naechste operative Schritt ist jetzt das Testsystem-Deployment.

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
