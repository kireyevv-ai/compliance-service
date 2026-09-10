"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ScanStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

export function ScanStatusView({ scanId }: { scanId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<ScanStatus>("QUEUED");
  const [error, setError] = useState<string | undefined>();
  const [statusNote, setStatusNote] = useState("Это может занять некоторое время.");

  useEffect(() => {
    let active = true;
    let attempts = 0;

    async function poll() {
      attempts += 1;

      let response: Response;
      let payload: { scan?: { status: ScanStatus; statusReason?: string | null }; error?: string };

      try {
        response = await fetch(`/api/scans/${scanId}`, { cache: "no-store" });
        payload = (await response.json()) as { scan?: { status: ScanStatus; statusReason?: string | null }; error?: string };
      } catch {
        if (!active) {
          return;
        }

        if (attempts < 120) {
          setStatusNote("Обновляем статус проверки. Если страница не перейдёт дальше, откройте результаты вручную.");
          window.setTimeout(poll, 2000);
        } else {
          setError("Не удалось обновить статус проверки. Обновите страницу позже.");
        }
        return;
      }

      if (!active) {
        return;
      }

      if (!response.ok || !payload.scan) {
        setError(payload.error ?? "Не удалось получить статус проверки.");
        return;
      }

      setStatus(payload.scan.status);
      setStatusNote("Это может занять некоторое время.");

      if (payload.scan.status === "COMPLETED") {
        router.replace(`/results/${scanId}`);
        return;
      }

      if (payload.scan.status === "FAILED") {
        setError(payload.scan.statusReason ?? "Проверка завершилась ошибкой.");
        return;
      }

      if (attempts < 120) {
        window.setTimeout(poll, 2000);
      } else {
        setError("Проверка занимает больше времени, чем ожидалось. Обновите страницу позже.");
      }
    }

    void poll();

    return () => {
      active = false;
    };
  }, [router, scanId]);

  if (error) {
    return (
      <section className="panel status-panel">
        <p className="eyebrow">FAILED</p>
        <h1>Не удалось проверить сайт</h1>
        <p>{error}</p>
        <a className="secondary-button" href="/">
          Попробовать ещё раз
        </a>
      </section>
    );
  }

  if (status === "COMPLETED") {
    return (
      <section className="panel status-panel">
        <p className="eyebrow">COMPLETED</p>
        <h1>Готовим результаты...</h1>
        <p>Проверка завершена. Открываем страницу результатов.</p>
        <a className="secondary-button" href={`/results/${scanId}`}>
          Открыть результаты
        </a>
      </section>
    );
  }

  return (
    <section className="panel status-panel">
      <div className="spinner" aria-hidden="true" />
      <p className="eyebrow">{status}</p>
      <h1>Проверяем сайт...</h1>
      <p>{statusNote}</p>
    </section>
  );
}
