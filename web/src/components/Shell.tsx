import { useRef, type MouseEvent, type ReactNode } from "react";
import type { ThemeName } from "../mode";
import type { Route } from "../routes";

export function Shell({
  theme,
  onToggleTheme,
  mock,
  disclaimer,
  route,
  children,
}: {
  theme: ThemeName;
  onToggleTheme: () => void;
  mock: boolean;
  disclaimer: string | null;
  route: Route;
  children: ReactNode;
}) {
  const next = theme === "black" ? "white" : "black";
  const mainRef = useRef<HTMLElement>(null);

  function goToContent(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    mainRef.current?.focus({ preventScroll: true });
    mainRef.current?.scrollIntoView({ block: "start" });
  }

  return (
    <>
      <a className="skip" href="#main" onClick={goToContent}>
        Skip to content
      </a>
      <div className="page">
        <header className="shell-header">
          <a className="brand" href="#/">
            <img
              className="theme-wordmark"
              src={`/logos/${theme}/psychosigh-wordmark.svg`}
              alt="PsychoSigh"
              width={240}
              height={44}
            />
          </a>
          <nav className="shell-nav" aria-label="Primary">
            <a href="#/" aria-current={route.name === "picker" ? "page" : undefined}>
              Conversations
            </a>
            {mock ? <span className="demo-flag">Demo data</span> : null}
          </nav>
          <button
            id="theme-toggle"
            className="theme-toggle"
            type="button"
            aria-pressed={theme === "white"}
            aria-label={`Switch to ${next} theme`}
            onClick={onToggleTheme}
          >
            <span className="theme-disc" aria-hidden="true" />
            <span className="theme-label">{theme === "black" ? "White" : "Black"} theme</span>
          </button>
        </header>
        <main id="main" tabIndex={-1} ref={mainRef}>
          {children}
        </main>
        <footer className="shell-footer">
          <img
            className="footer-symbol"
            src={`/logos/${theme}/psychosigh-symbol.svg`}
            alt=""
            width={48}
            height={48}
          />
          {disclaimer ? <span className="footer-disclaimer">{disclaimer}</span> : <span />}
          <a href="#main" onClick={goToContent}>Back to top</a>
        </footer>
      </div>
    </>
  );
}
