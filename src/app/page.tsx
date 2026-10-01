import { HomepageScanForm } from "@/app/components/homepage-scan-form";

const advantages = [
  { title: "Быстро", detail: "Проверка занимает несколько минут" },
  { title: "Понятно", detail: "Показываем, что в порядке и что нужно исправить" },
  { title: "Актуально", detail: "Учитываем действующие требования законодательства" },
  { title: "Честно", detail: "Показываем ограничения проверки" }
] as const;

export default function HomePage() {
  return (
    <main className="homepage">
      <header className="home-header">
        <div className="home-container home-header-inner">
          <a className="home-wordmark" href="/" aria-label="СайтНорма — главная">
            СайтНорма
          </a>
          <nav className="home-nav" aria-label="Основная навигация">
            <a href="#advantages">Как это работает</a>
            <span>Что проверяем</span>
            <span>Тарифы</span>
            <span>Нормативная база</span>
          </nav>
          <div className="home-header-actions">
            <a className="home-login-link" href="/beta">Войти</a>
            <a className="home-header-link" href="#site-address">Проверить сайт</a>
          </div>
        </div>
      </header>

      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-container home-hero-inner">
          <div className="home-hero-copy">
            <h1 id="home-title">Проверка сайта на соответствие требованиям законодательства РФ</h1>
            <p className="home-hero-lead">
              Находим риски, показываем, что уже в порядке, и даём понятные рекомендации по исправлению.
            </p>
            <HomepageScanForm />
            <p className="home-form-note">
              Экспресс — бесплатно · Полная проверка — до 58 применимых правил
            </p>
          </div>
        </div>
      </section>

      <section className="home-advantages" id="advantages" aria-label="Преимущества проверки">
        <div className="home-container home-advantages-inner">
          {advantages.map((item) => (
            <div className="home-advantage" key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
