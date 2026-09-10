"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SITE_TYPES = [
  {
    value: "B2B",
    label: "Корпоративный / B2B",
    description: "Сайт компании, работающей преимущественно с другими организациями."
  },
  {
    value: "B2C_SERVICE",
    label: "Услуги для физических лиц",
    description: "Сайт, на котором услуги предлагаются потребителям."
  },
  {
    value: "ECOMMERCE",
    label: "Интернет-магазин",
    description: "Продажа товаров через сайт."
  },
  {
    value: "OTHER",
    label: "Другое",
    description: ""
  }
] as const;

export function ScanForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [siteType, setSiteType] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!url.trim()) {
      setError("Укажите адрес сайта.");
      return;
    }

    if (!siteType) {
      setError("Выберите тип сайта.");
      return;
    }

    setSubmitting(true);
    const response = await fetch("/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, siteType })
    });
    const payload = (await response.json()) as { scanId?: string; error?: string };

    if (!response.ok || !payload.scanId) {
      setSubmitting(false);
      setError(payload.error ?? "Не удалось запустить проверку.");
      return;
    }

    router.push(`/scan/${payload.scanId}`);
  }

  return (
    <form className="scan-form" onSubmit={submit}>
      <label className="field">
        <span>Адрес сайта</span>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.ru"
          disabled={submitting}
        />
      </label>

      <fieldset className="site-types">
        <legend>Тип сайта</legend>
        {SITE_TYPES.map((item) => (
          <label className="site-type-option" key={item.value}>
            <input
              type="radio"
              name="siteType"
              value={item.value}
              checked={siteType === item.value}
              onChange={() => setSiteType(item.value)}
              disabled={submitting}
            />
            <span>
              <strong>{item.label}</strong>
              {item.description ? <small>{item.description}</small> : null}
            </span>
          </label>
        ))}
      </fieldset>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? "Запускаем проверку..." : "Проверить сайт"}
      </button>
    </form>
  );
}
