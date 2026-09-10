import { ScanForm } from "@/app/components/scan-form";

export default function HomePage() {
  return (
    <main className="shell">
      <section className="intro">
        <p className="eyebrow">Новая проверка</p>
        <h1>Проверка сайта</h1>
        <p>Проверьте сайт на основные требования российского законодательства.</p>
      </section>
      <section className="panel">
        <ScanForm />
      </section>
    </main>
  );
}
