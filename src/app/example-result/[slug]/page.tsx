import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/app/components/site-header";

const exampleFindings = {
  "personal-data-consent": {
    title: "В форме отсутствует отдельное согласие на обработку персональных данных",
    status: "Проблема",
    statusClass: "problem",
    category: "Персональные данные",
    sections: [
      {
        title: "Что найдено",
        text: "Форма собирает имя и телефон, но отдельное согласие рядом с отправкой не найдено."
      },
      { title: "Где обнаружено", text: "example.ru/booking" },
      {
        title: "Почему это важно",
        text: "Пользователь должен понимать условия обработки персональных данных до отправки формы."
      },
      {
        title: "Что сделать",
        text: "Добавить отдельный текст согласия и ссылку на политику обработки персональных данных рядом с отправкой формы."
      }
    ]
  },
  "analytics-disclosure": {
    title: "Используется сервис аналитики",
    status: "Требует внимания",
    statusClass: "attention",
    category: "Cookies и аналитика",
    sections: [
      { title: "Что найдено", text: "На сайте обнаружен сервис аналитики." },
      {
        title: "Почему требует внимания",
        text: "Нужно проверить, отражено ли его использование в документах сайта и настройках согласия."
      },
      {
        title: "Что сделать",
        text: "Проверить документы сайта и настройки использования аналитических cookies."
      }
    ]
  },
  "company-details": {
    title: "Реквизиты организации найдены",
    status: "В порядке",
    statusClass: "passed",
    category: "Сведения о владельце",
    sections: [
      {
        title: "Что найдено",
        text: "На сайте обнаружены необходимые сведения об организации."
      },
      { title: "Результат", text: "По этому пункту замечаний не найдено." }
    ]
  }
} as const;

type ExampleSlug = keyof typeof exampleFindings;

export function generateStaticParams() {
  return (Object.keys(exampleFindings) as ExampleSlug[]).map((slug) => ({ slug }));
}

export default async function ExampleFindingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!Object.prototype.hasOwnProperty.call(exampleFindings, slug)) notFound();

  const finding = exampleFindings[slug as ExampleSlug];

  return (
    <main className="homepage">
      <SiteHeader />
      <section className="example-finding-page" aria-labelledby="example-finding-title">
        <div className="home-container example-finding-container">
          <Link className="example-finding-back" href="/example-result">
            <span aria-hidden="true">←</span> Назад к результатам проверки
          </Link>
          <article className="example-finding-surface">
            <div className="example-finding-heading">
              <div className="example-finding-meta">
                <span className={`home-results-status home-results-status-${finding.statusClass}`}>
                  {finding.status}
                </span>
                <span>{finding.category}</span>
              </div>
              <h1 id="example-finding-title">{finding.title}</h1>
            </div>
            <div className="example-finding-sections">
              {finding.sections.map((section) => (
                <section className="example-finding-section" key={section.title}>
                  <h2>{section.title}</h2>
                  <p>{section.text}</p>
                </section>
              ))}
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
