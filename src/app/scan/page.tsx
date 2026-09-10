import Link from "next/link";

export default function ScanPage() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Проверка</p>
        <h1>Запустите новую проверку</h1>
        <p>Введите адрес сайта и выберите тип сайта, чтобы создать новый Scan.</p>
        <Link className="secondary-button" href="/">
          Перейти к форме
        </Link>
      </section>
    </main>
  );
}
