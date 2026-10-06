import styles from "./homepage-pricing.module.css";

const plans = [
  {
    label: "РАЗОВАЯ ПРОВЕРКА",
    title: "Полная проверка",
    price: "1 990 ₽",
    description: "Подробный анализ сайта с рекомендациями и правовыми основаниями.",
    features: [
      "До 58 применимых правил",
      "Уточняющие вопросы по сайту",
      "Рекомендации по исправлению",
      "Правовые основания (ссылки на нормы)",
      "PDF-отчёт"
    ],
    action: "Провести проверку",
    tone: "standard"
  },
  {
    label: "ПОДПИСКА",
    title: "Pro",
    price: "3 990 ₽",
    priceSuffix: "/ месяц",
    description: "Для регулярной работы с проверками и историей изменений.",
    features: [
      "Всё из полной проверки",
      "Повторные проверки сайта",
      "История проверок",
      "Сравнение результатов"
    ],
    action: "Выбрать Pro",
    tone: "featured",
    badge: "ПОПУЛЯРНЫЙ ВЫБОР"
  },
  {
    label: "ПОДПИСКА",
    title: "Business",
    price: "7 990 ₽",
    priceSuffix: "/ месяц",
    description: "Для компаний с несколькими сайтами и командой.",
    features: [
      "Всё из Pro",
      "Несколько сайтов",
      "Командный доступ",
      "История проверок по всем сайтам",
      "Сравнение результатов проверок"
    ],
    action: "Выбрать Business",
    tone: "standard"
  }
] as const;

const expressFeatures = ["1 сайт", "Базовые проверки", "Короткий результат", "Без регистрации"] as const;

export function HomepagePricing() {
  return (
    <section className={styles.pricing} id="pricing" aria-labelledby="pricing-title">
      <div className={`home-container ${styles.pricingInner}`}>
        <header className={styles.pricingIntro}>
          <h2 id="pricing-title">Выберите подходящий тариф</h2>
          <p>Начните с бесплатной проверки. Переходите к полной проверке или регулярной работе, когда это понадобится.</p>
        </header>

        <article className={styles.expressPlan}>
          <div className={styles.expressSummary}>
            <p className={styles.planLabel}>БЕСПЛАТНО</p>
            <h3>Экспресс-проверка</h3>
            <p className={styles.planDescription}>Быстрая проверка сайта по ключевым требованиям.</p>
          </div>
          <ul className={styles.expressFeatures}>
            {expressFeatures.map((feature) => <li key={feature}>{feature}</li>)}
          </ul>
          <div className={styles.expressAction}>
            <a className={styles.primaryAction} href="#site-address">Проверить бесплатно <span aria-hidden="true">→</span></a>
            <p>Это займёт не больше 1–2 минут.</p>
          </div>
        </article>

        <div className={styles.planGrid}>
          {plans.map((plan) => (
            <article className={`${styles.planCard} ${plan.tone === "featured" ? styles.featuredPlan : ""}`} key={plan.title}>
              <div className={styles.planContent}>
                <div className={styles.planMeta}>
                  <p className={styles.planLabel}>{plan.label}</p>
                  {"badge" in plan && <span className={styles.popularBadge}>{plan.badge}</span>}
                </div>
                <h3>{plan.title}</h3>
                <p className={styles.price}>
                  <strong>{plan.price}</strong>
                  {"priceSuffix" in plan && <span>{plan.priceSuffix}</span>}
                </p>
                <p className={styles.planDescription}>{plan.description}</p>
                <ul className={styles.planFeatures}>
                  {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                </ul>
              </div>
              <a className={plan.tone === "featured" ? styles.primaryAction : styles.secondaryAction} href="#site-address">
                {plan.action} <span aria-hidden="true">→</span>
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
