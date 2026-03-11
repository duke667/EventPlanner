# Infrastruktur

Das Projekt nutzt zwei Compose-Setups:

- [docker-compose.yml](/home/sascha/Projects/EventManager/docker-compose.yml) fuer lokale Entwicklung
- [docker-compose.testsystem.yml](/home/sascha/Projects/EventManager/docker-compose.testsystem.yml) fuer das interne Testsystem

## Lokal

- PostgreSQL auf `localhost:5432`
- Redis auf `localhost:6379`
- Mailpit SMTP auf `localhost:1025`
- Mailpit UI auf `http://localhost:8025`

## Start

```bash
docker-compose up -d
```

## Stop

```bash
docker-compose down
```

## Testsystem

Siehe [Deployment Testsystem](/home/sascha/Projects/EventManager/docs/deployment-testsystem.md).
