import { Logo, useI18n } from '@resto-hub/design-system';

interface FooterColumn {
  title: string;
  links: Array<{ label: string; href: string }>;
}

export function SiteFooter() {
  const { t, tm } = useI18n();
  const columns = tm<Record<'product' | 'resources' | 'legal', FooterColumn>>('footer.columns');

  return (
    <footer className="site-footer" id="contact">
      <div className="site-container site-footer__grid">
        <div className="site-footer__brand">
          <Logo withWordmark inverse size={30} />
          <p>{t('footer.tagline')}</p>
          <div className="site-footer__compliance">
            <span className="site-footer__pill">{t('footer.compliance')}</span>
            <span className="site-footer__pill">XOF · FR / EN</span>
          </div>
        </div>
        {(['product', 'resources', 'legal'] as const).map((key) => (
          <div className="site-footer__column" key={key}>
            <h3>{columns[key].title}</h3>
            <ul>
              {columns[key].links.map((link) => (
                <li key={link.label}>
                  <a href={link.href}>{link.label}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="site-container site-footer__bottom">
        <p className="site-footer__note">{t('footer.demoNote')}</p>
        <p>{t('footer.copyright')}</p>
      </div>
    </footer>
  );
}
