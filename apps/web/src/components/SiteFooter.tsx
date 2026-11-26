import { Icon, Logo, useI18n } from '@resto-hub/design-system';

interface FooterColumn {
  title: string;
  links: Array<{ label: string; href: string }>;
}

export function SiteFooter() {
  const { t, tm } = useI18n();
  const columns = tm<Record<'product' | 'resources' | 'legal', FooterColumn>>('footer.columns');

  return (
    <footer className="cfoot" id="contact">
      <div className="site-container">
        <div className="cfoot__panel">
          <div className="cfoot__grid">
            <div className="cfoot__brand">
              <Logo withWordmark size={30} />
              <p>{t('footer.tagline')}</p>
              <div className="cfoot__contact">
                <span>
                  <Icon name="pin" size="sm" />
                  Lomé, Togo
                </span>
                <span>
                  <Icon name="monitor" size="sm" />
                  resto-hub.tg
                </span>
              </div>
              <div className="cfoot__pills">
                <span className="cfoot__pill">{t('footer.compliance')}</span>
                <span className="cfoot__pill">XOF · FR / EN</span>
              </div>
            </div>
            {(['product', 'resources', 'legal'] as const).map((key) => (
              <div className="cfoot__column" key={key}>
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
          <div className="cfoot__bottom">
            <p className="cfoot__note">{t('footer.demoNote')}</p>
            <p>{t('footer.copyright')}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
