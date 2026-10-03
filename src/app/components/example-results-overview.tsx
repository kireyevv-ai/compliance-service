"use client";

import Link from "next/link";
import { useState } from "react";

const categories = [
  { id: "all", label: "Все" },
  { id: "personal", label: "Персональные данные" },
  { id: "cookies", label: "Cookies и аналитика" },
  { id: "advertising", label: "Реклама" },
  { id: "commerce", label: "Интернет-магазин" },
  { id: "documents", label: "Документы" }
] as const;

type CategoryId = (typeof categories)[number]["id"];

const findings = [
  {
    id: "consent",
    slug: "personal-data-consent",
    categoryId: "personal",
    category: "Персональные данные",
    status: "Проблема",
    statusClass: "problem",
    title: "В форме отсутствует отдельное согласие на обработку персональных данных",
    description: "Форма собирает имя и телефон, но отдельное согласие рядом с отправкой не найдено."
  },
  {
    id: "analytics",
    slug: "analytics-disclosure",
    categoryId: "cookies",
    category: "Cookies и аналитика",
    status: "Требует внимания",
    statusClass: "attention",
    title: "Используется сервис аналитики",
    description: "Нужно проверить, отражено ли его использование в документах сайта."
  },
  {
    id: "company",
    slug: "company-details",
    categoryId: "documents",
    category: "Сведения о владельце",
    status: "В порядке",
    statusClass: "passed",
    title: "Реквизиты организации найдены",
    description: null
  }
] as const;

export function ExampleResultsOverview() {
  const [activeCategory, setActiveCategory] = useState<CategoryId>("all");
  const visibleFindings = findings.filter(
    (finding) => activeCategory === "all" || finding.categoryId === activeCategory
  );

  return (
    <div className="home-results-surface">
      <div className="home-results-topline">
        <div className="home-results-identity">
          <strong>example.ru</strong>
          <span className="home-results-complete">Проверка завершена</span>
        </div>
      </div>

      <div className="home-results-summary" aria-label="Сводка результатов">
        <div className="home-results-count home-results-count-problem"><strong>2</strong><span>Проблемы</span></div>
        <div className="home-results-count home-results-count-attention"><strong>3</strong><span>Требует внимания</span></div>
        <div className="home-results-count home-results-count-review"><strong>1</strong><span>Требует уточнения</span></div>
        <div className="home-results-count home-results-count-passed"><strong>18</strong><span>В порядке</span></div>
      </div>

      <div className="home-results-tabs" role="group" aria-label="Категории результатов">
        {categories.map((category) => (
          <button
            className={activeCategory === category.id ? "home-results-tab is-active" : "home-results-tab"}
            key={category.id}
            type="button"
            aria-pressed={activeCategory === category.id}
            onClick={() => setActiveCategory(category.id)}
          >
            {category.label}
          </button>
        ))}
      </div>

      <div className="home-results-list" aria-live="polite">
        {visibleFindings.length ? visibleFindings.map((finding) => (
          <div className="home-results-finding" key={finding.id}>
            <span className={`home-results-status home-results-status-${finding.statusClass}`}>{finding.status}</span>
            <div className="home-results-finding-main">
              <div className="home-results-finding-heading">
                <strong>{finding.title}</strong>
                <span>{finding.category}</span>
              </div>
              {finding.description && <p>{finding.description}</p>}
            </div>
            <Link className="home-results-more" href={`/example-result/${finding.slug}`}>
              Подробнее <span aria-hidden="true">→</span>
            </Link>
          </div>
        )) : (
          <p className="home-results-empty">В этом примере результатов нет.</p>
        )}
      </div>
    </div>
  );
}
