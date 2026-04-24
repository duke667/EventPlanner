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
- optionale Begleitperson pro Event
- Einladungslisten pro Event
- Versand von personalisierten Einladungsmails mit Serienbrief-Platzhaltern
- Gastregistrierung ueber personalisierten Link
- Versand von Bestaetigungsmails mit ICS-Datei
- Teilnehmerstatus pro Event
- Live-Dashboard fuer Veranstaltungsmanager
- Mobile Check-in-Oberflaeche
- manueller Check-in
- QR-Code-Check-in mit Vorschau und Begleitpersonen-Bestaetigung

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
- pro Event festlegen, ob eine Begleitung erlaubt ist
- Einladungslisten zusammenstellen
- Gaestelisten direkt fuer ein Event importieren
- Einladungstexte mit Platzhaltern vorbereiten
- E-Mails versenden
- Anmeldestatus einsehen
- Live-Kennzahlen der Veranstaltung einsehen
- Check-in am Eventtag durchfuehren

### Gast

- Einladung per E-Mail erhalten
- ueber Link registrieren oder absagen
- falls erlaubt, eine Begleitperson mit Vor- und Nachname anmelden
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

Aktueller Importstand:

- Allgemeiner Kontaktimport unterstuetzt CSV und XLSX.
- Fuer eine Veranstaltung kann eine Gaesteliste direkt im Einladungsbereich importiert werden.
- Die Stadtgeburtstag-Teststruktur wird aktuell ueber Spalten wie `Anrede`, `PersAnrede`, `Name`, `Vorname`, `PLZ`, `Ort`, `Straße`, `Amt`, `Position`, `Firma`, `Mail-Dienstl1`, `Mail-Privat`, `Telefon` und DSGVO-Felder verarbeitet.
- Dienstliche E-Mail wird bevorzugt, private E-Mail dient als Fallback.
- Spezielle Importfelder stehen fuer Serienbrief-Platzhalter zur Verfuegung, z. B. `{{custom.amt}}`, `{{custom.position}}`, `{{custom.zusatz}}` oder `{{excel.Anrede}}`.

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
- Option, ob die Einladung nur persoenlich gilt oder ob eine Begleitung erlaubt ist

### 4.3 Einladungsliste erzeugen

- Mitarbeiter waehlt Kontakte fuer ein Event aus.
- Alternativ importiert er eine Gaesteliste direkt fuer das Event.
- System erzeugt pro Kontakt eine Event-Einladung.
- Jede Einladung bekommt einen eindeutigen Token fuer Antwort- und Check-in-Prozesse.
- Fuer importierte Gaestelisten werden Kontakte per E-Mail-Adresse angelegt oder aktualisiert und direkt dem Event zugeordnet.

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

- Mitarbeiter erstellt einen Einladungstext mit Serienbrief-Platzhaltern.
- Gast erhaelt E-Mail mit persoenlichem Link und individualisiertem Text.
- Gast landet auf einer schlanken Registrierungsseite.
- Gast bestaetigt Teilnahme oder sagt ab.
- Wenn das Event Begleitung erlaubt, kann der Gast eine Begleitperson mit Vor- und Nachname angeben.
- Fuer Begleitungen wird im aktuellen Stand keine separate Einladung erzeugt.
- Nach erfolgreicher Anmeldung wird der Teilnehmerstatus aktualisiert.

### 4.5 Bestaetigung und Kalendereintrag

- Nach Anmeldung versendet das System automatisch eine Bestaetigung.
- Die Mail enthaelt eine ICS-Datei als Anhang.
- Optional kann zusaetzlich ein QR-Code mitgesendet werden.

### 4.6 Check-in am Eventtag

- Mitarbeiter oeffnet auf Smartphone oder Tablet die Check-in-Ansicht.
- Suche nach Name, Firma oder E-Mail muss schnell funktionieren.
- Gast kann manuell als anwesend markiert werden.
- Ein QR-Code kann gescannt werden.
- Nach dem Scan zeigt das System eine Vorschau des Gasts.
- Wenn eine Begleitung angemeldet ist, bestaetigt der Check-in-Mitarbeiter per Haken, ob diese Begleitung tatsaechlich dabei ist.
- Die Veranstaltungsauswertung zaehlt eingecheckte Personen inklusive bestaetigter Begleitungen.
- Nicht eingeladene Personen koennen als Walk-in dokumentiert werden, wenn gewuenscht.

### 4.7 Live-Dashboard

- Veranstaltungsmanager waehlen ein Event und sehen den aktuellen Veranstaltungsstand.
- Sichtbar sind eingeladene, zugesagte, offene, abgesagte und eingecheckte Gaeste.
- Zusaetzlich werden erwartete Personen, Personen vor Ort, Begleitungen, Einlassquote und Kapazitaetsauslastung berechnet.
- Listen zeigen zugesagte Gaeste, die noch nicht eingecheckt sind, sowie die zuletzt eingecheckten Personen.

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
- Live-Dashboard pro Veranstaltung
- Check-in-Liste auf Mobilgeraeten bedienen

### Gastbereich

- personalisierte Registrierungsseite
- Begleitpersonen-Angabe, falls im Event erlaubt
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
