import Link from "next/link";

export default function ResultsIndexPage() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Результаты</p>
        <h1>Выберите проверку</h1>
        <p>Результаты открываются автоматически после завершения новой проверки.</p>
        <Link className="secondary-button" href="/">
          Запустить проверку
        </Link>
      </section>
    </main>
  );
}
