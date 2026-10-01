"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const siteTypes = [
  { value: "B2B", label: "Сайт для бизнеса" },
  { value: "B2C_SERVICE", label: "Сайт услуг" },
  { value: "ECOMMERCE", label: "Интернет-магазин" },
  { value: "OTHER", label: "Другое" }
] as const;

export function HomepageScanForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [siteType, setSiteType] = useState("");
  const [needsSiteType, setNeedsSiteType] = useState(false);
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
      setNeedsSiteType(true);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, siteType })
      });
      const payload = (await response.json()) as { scanId?: string; error?: string };
      if (!response.ok || !payload.scanId) {
        setError(payload.error ?? "Не удалось запустить проверку.");
        return;
      }
      router.push(`/scan/${payload.scanId}`);
    } catch {
      setError("Не удалось запустить проверку. Попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="home-scan-form" onSubmit={submit}>
      <div className="home-url-control">
        <label className="home-visually-hidden" htmlFor="site-address">Адрес сайта</label>
        <input
          id="site-address"
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://ваш-сайт.ru"
          disabled={submitting}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? "Запускаем проверку…" : "Проверить бесплатно"}
          {!submitting && <span aria-hidden="true">→</span>}
        </button>
      </div>
      {needsSiteType && (
        <div className="home-site-type-control">
          <label htmlFor="home-site-type">Уточните тип сайта</label>
          <select
            id="home-site-type"
            value={siteType}
            onChange={(event) => setSiteType(event.target.value)}
            disabled={submitting}
            required
          >
            <option value="">Выберите тип сайта</option>
            {siteTypes.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
