import { HomepageScanForm } from "@/app/components/homepage-scan-form";
import { HomepagePricing } from "@/app/components/homepage-pricing";
import { SiteHeader } from "@/app/components/site-header";

const advantages = [
  { title: "Быстро", detail: "Проверка занимает несколько минут" },
  { title: "Понятно", detail: "Показываем, что в порядке и что нужно исправить" },
  { title: "Актуально", detail: "Учитываем действующие требования законодательства" },
  { title: "Честно", detail: "Показываем ограничения проверки" }
] as const;

const coverageAreas = [
  "Персональные данные",
  "Cookies и аналитика",
  "Сведения о владельце",
  "Продажа товаров и услуг",
  "Реклама и рассылки",
  "Рекомендательные технологии",
  "Обязательная информация",
  "Русский язык"
] as const;

export default function HomePage() {
  return (
    <main className="homepage">
      <SiteHeader />

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

      <section className="home-coverage" id="what-we-check" aria-labelledby="home-coverage-title">
        <div className="home-container home-coverage-inner">
          <div className="home-coverage-intro">
            <h2 id="home-coverage-title">Что проверяет СайтНорма</h2>
            <p>Проверяем только те требования, которые применимы к конкретному сайту и его функциональности.</p>
          </div>
          <div className="home-coverage-grid" id="what-we-check-list">
            {coverageAreas.map((area) => (
              <div className="home-coverage-item" key={area}>
                <h3>{area}</h3>
              </div>
            ))}
          </div>
          <div className="home-coverage-footer">
            <p>До 58 применимых правил. Конкретный набор зависит от типа сайта и его функциональности.</p>
            <a href="#what-we-check-list">Посмотреть все направления <span aria-hidden="true">→</span></a>
          </div>
        </div>
      </section>

      <HomepagePricing />

    </main>
  );
}
