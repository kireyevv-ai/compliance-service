export const dynamic = "force-dynamic";

export default async function BetaAccessPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="shell">
      <section className="intro">
        <p className="eyebrow">Closed beta</p>
        <h1>Доступ к проверке</h1>
        <p>Введите пароль beta-доступа, выданный владельцем продукта.</p>
      </section>
      <section className="panel">
        <form className="scan-form" action="/api/beta-access" method="post">
          <label className="field">
            <span>Пароль</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error ? <p className="form-error">Неверный пароль beta-доступа.</p> : null}
          <button className="primary-button" type="submit">
            Войти
          </button>
        </form>
      </section>
    </main>
  );
}
