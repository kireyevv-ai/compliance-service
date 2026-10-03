import { ExampleResultsOverview } from "@/app/components/example-results-overview";
import { SiteHeader } from "@/app/components/site-header";

export default function ExampleResultPage() {
  return (
    <main className="homepage">
      <SiteHeader />
      <section className="home-results-preview" aria-labelledby="example-result-title">
        <div className="home-container home-results-inner">
          <div className="home-results-intro">
            <h1 id="example-result-title">Пример результата проверки</h1>
            <p>Посмотрите, как СайтНорма показывает найденные проблемы, что требует уточнения и что уже в порядке.</p>
          </div>
          <ExampleResultsOverview />
        </div>
      </section>
    </main>
  );
}
