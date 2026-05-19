import { Link } from "react-router-dom";
import { ReactNode } from "react";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface LegalPageLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function LegalPageLayout({ title, subtitle, children }: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/" className="font-bold text-lg" style={{ fontFamily: "'Unbounded', sans-serif" }}>
            oTutorHub
          </Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← На головну
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl md:text-4xl font-bold mb-3" style={{ fontFamily: "'Unbounded', sans-serif" }}>
          {title}
        </h1>
        {subtitle && <p className="text-muted-foreground mb-10">{subtitle}</p>}

        <article className="legal-content space-y-5 text-[15px] leading-relaxed">
          {children}
        </article>

        <div className="mt-16 pt-8 border-t border-border text-sm text-muted-foreground flex flex-wrap gap-4 justify-between">
          <Link to="/terms" className="hover:text-foreground">{t("legal.terms")}</Link>
          <Link to="/privacy" className="hover:text-foreground">{t("legal.privacy")}</Link>
          <a href="mailto:hello@otutorhub.com" className="hover:text-foreground">hello@otutorhub.com</a>
        </div>
      </main>
    </div>
  );
}
