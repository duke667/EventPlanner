const modules = [
  {
    title: "Kontakte",
    text: "Kontaktverwaltung mit Suche, Tags und Datei-Import fuer CSV/XLSX.",
  },
  {
    title: "Events",
    text: "Events anlegen, Teilnehmerlisten aufbauen und Einladungen steuern.",
  },
  {
    title: "Registrierung",
    text: "Gastlinks, Zusagen/Absagen, Bestaetigungs-Mail und ICS-Versand.",
  },
  {
    title: "Check-in",
    text: "Mobile Einlassansicht mit Suche und spaeterem QR-Code-Scan.",
  },
];

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">EventManager MVP</p>
        <h1>Interne Eventorganisation von Einladung bis Check-in.</h1>
        <p className="lead">
          Das Projektgeruest steht. Als naechstes bauen wir Auth, Kontakte,
          Events, Versand und den mobilen Einlassprozess.
        </p>
      </section>

      <section className="grid">
        {modules.map((module) => (
          <article className="card" key={module.title}>
            <h2>{module.title}</h2>
            <p>{module.text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
