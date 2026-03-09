# Lokale Infrastruktur

Das Projekt nutzt fuer die lokale Entwicklung aktuell `docker-compose`.

## Dienste

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
