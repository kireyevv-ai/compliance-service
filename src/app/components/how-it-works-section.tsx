import styles from "./how-it-works-section.module.css";

const processSteps = [
  {
    title: "Указать сайт",
    description: "Введите адрес сайта и запустите проверку.",
    icon: (
      <>
        <rect x="2" y="3" width="20" height="18" rx="2" />
        <path d="M2 8h20M7 13h10M7 17h6" />
      </>
    )
  },
  {
    title: "Проверить страницы сайта",
    description: "Анализируем страницы, формы, документы и доступные технические признаки.",
    icon: (
      <>
        <path d="M12 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8l6 6v4M14 2v6h6M8 12h3" />
        <circle cx="16" cy="16" r="3.5" />
        <path d="m18.5 18.5 3.5 3.5" />
      </>
    )
  },
  {
    title: "Уточнить недостающие сведения",
    description: "Если по сайту нельзя сделать вывод, задаём только необходимые вопросы.",
    icon: (
      <>
        <path d="M8 18H6l-3 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H8" />
        <path d="M9.5 8a2.5 2.5 0 0 1 5 0c0 1.5-2.5 1.5-2.5 3M12 14h.01" />
      </>
    )
  },
  {
    title: "Получить результат",
    description: "Показываем, что исправить, что уточнить и что уже в порядке.",
    icon: (
      <>
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M8 7h8M8 11h5m-5 6 2 2 6-6" />
      </>
    )
  }
] as const;

export function HowItWorksSection() {
  return (
    <section className={styles.homeProcess} aria-labelledby="home-process-title">
      <div className={`home-container ${styles.homeProcessInner}`}>
        <div className={styles.homeProcessIntro}>
          <h2 id="home-process-title">Как проходит проверка</h2>
          <p>От адреса сайта до понятного списка результатов — без лишних действий со стороны пользователя.</p>
        </div>
        <ol className={styles.homeProcessSteps}>
          {processSteps.map((step, index) => (
            <li className={styles.homeProcessStep} key={step.title}>
              <span className={styles.homeProcessIndexRow} aria-hidden="true">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <svg
                  className={styles.homeProcessIcon}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.65"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  focusable="false"
                >
                  {step.icon}
                </svg>
              </span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
