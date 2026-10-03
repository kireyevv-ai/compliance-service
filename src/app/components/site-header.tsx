export function SiteHeader() {
  return (
    <header className="home-header">
      <div className="home-container home-header-inner">
        <a className="home-wordmark" href="/" aria-label="СайтНорма — главная">
          СайтНорма
        </a>
        <nav className="home-nav" aria-label="Основная навигация">
          <a href="/#what-we-check">Что проверяем</a>
          <span>Тарифы</span>
          <span>Нормативная база</span>
        </nav>
        <div className="home-header-actions">
          <a className="home-login-link" href="/beta">Войти</a>
          <a className="home-header-link" href="/#site-address">Проверить сайт</a>
        </div>
      </div>
    </header>
  );
}
