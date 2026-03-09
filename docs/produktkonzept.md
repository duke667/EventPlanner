# Produktkonzept EventManager

## 1. Ziel

EventManager ist ein internes Tool fuer Unternehmen, das den gesamten Prozess von Eventplanung bis Einlasskontrolle in einer Anwendung abbildet.

Kernnutzen:

- zentrale Verwaltung von Kontakten und Einladungen
- reproduzierbarer Prozess fuer Eventorganisation
- weniger manueller Aufwand bei Anmeldungen und Bestaetigungen
- transparente Teilnehmerliste fuer den Eventtag
- Grundlage fuer spaetere Erweiterungen wie Warteliste, Reminder, Mehrsprachigkeit oder Badge-Druck

## 2. MVP-Umfang

Der erste sinnvolle MVP sollte folgende Faehigkeiten enthalten:

- Login fuer Mitarbeiter
- Kontaktverwaltung
- Kontaktimport per Excel oder CSV
- Eventverwaltung
- Einladungslisten pro Event
- Versand von Einladungsmails
- Gastregistrierung ueber personalisierten Link
- Versand von Bestaetigungsmails mit ICS-Datei
- Teilnehmerstatus pro Event
- Mobile Check-in-Oberflaeche
- manueller Check-in
- optionaler QR-Code-Check-in

Nicht im ersten MVP:

- komplexe Rollen- und Mandantenfaehigkeit
- Landingpages mit CMS-Logik
- Payment
- offene Self-Service-Registrierung ohne Einladung
- umfangreiche Marketing-Automation
- native App

## 3. Nutzerrollen

### Mitarbeiter / Event-Team

- Kontakte anlegen, bearbeiten, importieren
- Events erstellen und bearbeiten
- Einladungslisten zusammenstellen
- E-Mails versenden
- Anmeldestatus einsehen
- Check-in am Eventtag durchfuehren

### Gast

- Einladung per E-Mail erhalten
- ueber Link registrieren oder absagen
- Bestaetigungsmail mit Eventdetails erhalten
- optional QR-Code am Eventtag vorzeigen

### Admin

Kann im MVP mit der Mitarbeiterrolle zusammenfallen. Spaeter zusaetzlich:

- Benutzerverwaltung
- Systemeinstellungen
- Mail-Templates
- Importregeln

## 4. Kernprozesse

### 4.1 Kontaktpflege

- Mitarbeiter legt einzelne Kontakte an oder importiert eine Datei.
- Importdatei wird validiert und einer internen Feldstruktur zugeordnet.
- Duplikate werden markiert, nicht stillschweigend ueberschrieben.

Wichtige Kontaktfelder:

- Anrede
- Vorname
- Nachname
- E-Mail
- Telefon
- Firma
- Position
- Adresse
- Tags oder Kategorien
- Notizen
- Einwilligungs- oder Kommunikationsstatus

### 4.2 Event anlegen

Ein Event benoetigt mindestens:

- Titel
- Beschreibung
- Ort
- Startdatum und Startzeit
- Enddatum und Endzeit
- Zeitzone
- maximale Teilnehmerzahl optional
- Ansprechpartner
- Status `draft`, `published`, `closed`, `archived`

### 4.3 Einladungsliste erzeugen

- Mitarbeiter waehlt Kontakte fuer ein Event aus.
- System erzeugt pro Kontakt eine Event-Einladung.
- Jede Einladung bekommt einen eindeutigen Token fuer Antwort- und Check-in-Prozesse.

Statusmodell einer Einladung:

- `draft`
- `scheduled`
- `sent`
- `opened` optional spaeter
- `registered`
- `declined`
- `checked_in`
- `no_show`
- `cancelled`

### 4.4 Einladung und Anmeldung

- Gast erhaelt E-Mail mit persoenlichem Link.
- Gast landet auf einer schlanken Registrierungsseite.
- Gast bestaetigt Teilnahme oder sagt ab.
- Optional koennen Zusatzdaten abgefragt werden, z. B. Essenswuensche oder Begleitperson.
- Nach erfolgreicher Anmeldung wird der Teilnehmerstatus aktualisiert.

### 4.5 Bestaetigung und Kalendereintrag

- Nach Anmeldung versendet das System automatisch eine Bestaetigung.
- Die Mail enthaelt eine ICS-Datei als Anhang.
- Optional kann zusaetzlich ein QR-Code mitgesendet werden.

### 4.6 Check-in am Eventtag

- Mitarbeiter oeffnet auf Smartphone oder Tablet die Check-in-Ansicht.
- Suche nach Name, Firma oder E-Mail muss schnell funktionieren.
- Gast kann manuell als anwesend markiert werden.
- Optional kann ein QR-Code gescannt werden.
- Nicht eingeladene Personen koennen als Walk-in dokumentiert werden, wenn gewuenscht.

## 5. Fachliches Datenmodell

### Hauptobjekte

- `users`
  - Mitarbeiterkonten fuer das Backoffice
- `contacts`
  - zentrale Kontaktbasis
- `contact_imports`
  - Importlaeufe inklusive Datei, Mapping und Fehlern
- `events`
  - Metadaten des Events
- `event_invitations`
  - Zuordnung Kontakt <-> Event mit Status, Tokens und Versanddaten
- `event_registrations`
  - Anmeldedaten eines Gasts
- `check_ins`
  - Zeitpunkte und Art des Einlasses
- `email_jobs`
  - Versandauftraege und Zustellstatus
- `audit_logs`
  - Nachvollziehbarkeit kritischer Aenderungen

### Wichtige Relationen

- ein Kontakt kann zu vielen Events eingeladen werden
- ein Event hat viele Einladungen
- eine Einladung kann genau eine Registrierung haben
- eine Einladung kann null oder mehrere Check-in-Ereignisse haben

## 6. Funktionale Anforderungen

### Backoffice

- Kontakte filtern, suchen, importieren, exportieren
- Event erstellen, editieren, duplizieren
- Einladungen gesammelt erzeugen
- Mailversand starten
- Teilnehmerstatus live einsehen
- Check-in-Liste auf Mobilgeraeten bedienen

### Gastbereich

- personalisierte Registrierungsseite
- sichere Token-Links ohne Login
- responsive Darstellung
- klare Erfolgs- und Fehlermeldungen

## 7. Nichtfunktionale Anforderungen

- responsive Backoffice-Ansichten fuer Tablet und Smartphone
- DSGVO-konforme Speicherung personenbezogener Daten
- saubere Protokollierung von Importen und Mailversand
- nachvollziehbare Statusaenderungen
- robuste Fehlerbehandlung bei Import, Mailversand und QR-Scan
- Moeglichkeit fuer spaetere Internationalisierung

## 8. Sicherheits- und Datenschutzthemen

- Mitarbeiterzugang nur authentifiziert
- rollenbasierte Freigaben im Backend
- Gastlinks als signierte, ausreichend lange Zufallstoken
- personenbezogene Daten in der Datenbank verschluesselt, sofern sinnvoll
- keine sensiblen Informationen im QR-Code im Klartext
- revisionsnahe Protokollierung von Aenderungen
- Loesch- oder Anonymisierungskonzept fuer alte Events und Kontakte

## 9. MVP-Entscheidungen

Empfohlene Vereinfachungen fuer einen schnellen Projektstart:

- nur eine Organisation / ein Mandant
- nur Mitarbeiter-Login, keine oeffentliche Benutzerverwaltung fuer Gaeste
- Import zuerst fuer CSV und XLSX
- Mailversand ueber einen externen Provider
- QR-Code nur als Abbildung eines signierten Tokens
- Check-in nur online, kein Offline-Sync im ersten Schritt

## 10. Spaetere Erweiterungen

- Warteliste bei ausgebuchten Events
- Reminder- und Follow-up-Mails
- mehrere Tickettypen oder Kontingente
- Badge- oder Namensschild-Druck
- Event-Landingpages mit Branding
- mehrsprachige Einladungen
- Rollenmodell mit Admin, Editor, Check-in-only
- Offline-Check-in fuer instabile Netzwerke
