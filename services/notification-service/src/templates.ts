export type TemplateChannel = 'sms' | 'email' | 'push';
export type TemplateLocale = 'fr' | 'en';

export interface TemplateSeed {
  code: string;
  name: string;
  channel: TemplateChannel;
  locale: TemplateLocale;
  subject: string | null;
  body: string;
}

export const TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    code: 'AUTH_OTP',
    name: 'Code de connexion',
    channel: 'sms',
    locale: 'fr',
    subject: null,
    body: 'Votre code RESTO-HUB est {{code}}. Valable 5 minutes. Ne le partagez jamais.',
  },
  {
    code: 'AUTH_OTP',
    name: 'Sign-in code',
    channel: 'sms',
    locale: 'en',
    subject: null,
    body: 'Your RESTO-HUB code is {{code}}. Valid for 5 minutes. Never share it.',
  },
  {
    code: 'ORDER_READY',
    name: 'Commande prête',
    channel: 'push',
    locale: 'fr',
    subject: null,
    body: 'Commande {{number}} prête. Merci de la retirer au comptoir.',
  },
  {
    code: 'ORDER_READY',
    name: 'Order ready',
    channel: 'push',
    locale: 'en',
    subject: null,
    body: 'Order {{number}} is ready. Please collect it at the counter.',
  },
  {
    code: 'ORDER_CONFIRMED',
    name: 'Reçu de commande',
    channel: 'email',
    locale: 'fr',
    subject: 'Commande {{number}} payée — merci !',
    body: 'Bonjour {{name}},\n\nVotre commande {{number}} a bien été payée ({{amount}} F CFA).\nMerci de votre visite chez {{tenantName}}.\n\nÀ très bientôt !',
  },
  {
    code: 'ORDER_CONFIRMED',
    name: 'Order receipt',
    channel: 'email',
    locale: 'en',
    subject: 'Order {{number}} paid — thank you!',
    body: 'Hello {{name}},\n\nYour order {{number}} has been paid ({{amount}} XOF).\nThank you for visiting {{tenantName}}.\n\nSee you soon!',
  },
  {
    code: 'RESERVATION_REMINDER',
    name: 'Rappel de réservation',
    channel: 'sms',
    locale: 'fr',
    subject: null,
    body: 'Rappel : table {{tableCode}} réservée à {{time}} chez {{tenantName}}. Répondez STOP pour ne plus recevoir de rappels.',
  },
  {
    code: 'RESERVATION_REMINDER',
    name: 'Reservation reminder',
    channel: 'sms',
    locale: 'en',
    subject: null,
    body: 'Reminder: table {{tableCode}} booked at {{time}} at {{tenantName}}.',
  },
  {
    code: 'STOCK_ALERT',
    name: 'Alerte de stock',
    channel: 'push',
    locale: 'fr',
    subject: null,
    body: '{{name}} : {{quantity}} {{unit}} restants (seuil {{threshold}}). Réassort conseillé.',
  },
  {
    code: 'STOCK_ALERT',
    name: 'Stock alert',
    channel: 'push',
    locale: 'en',
    subject: null,
    body: '{{name}}: {{quantity}} {{unit}} left (threshold {{threshold}}). Restock advised.',
  },
  {
    code: 'PAYROLL_PAID',
    name: 'Paie versée',
    channel: 'email',
    locale: 'fr',
    subject: 'Bulletin de paie {{period}} disponible',
    body: 'Bonjour {{name}},\n\nLa paie de {{period}} a été versée pour un net de {{net}} F CFA.\nVotre bulletin est disponible dans l’application RESTO-HUB.\n\nService paie — {{tenantName}}',
  },
  {
    code: 'PAYROLL_PAID',
    name: 'Payroll paid',
    channel: 'email',
    locale: 'en',
    subject: 'Payslip {{period}} available',
    body: 'Hello {{name}},\n\nThe {{period}} payroll has been paid (net {{net}} XOF).\nYour payslip is available in RESTO-HUB.\n\nPayroll — {{tenantName}}',
  },
  {
    code: 'WELCOME',
    name: 'Bienvenue',
    channel: 'email',
    locale: 'fr',
    subject: 'Bienvenue chez {{tenantName}}',
    body: 'Bonjour {{name}},\n\nVotre compte est prêt. Scannez le QR de votre table pour commander et cumuler vos points fidélité.\n\nL’équipe {{tenantName}}',
  },
  {
    code: 'WELCOME',
    name: 'Welcome',
    channel: 'email',
    locale: 'en',
    subject: 'Welcome to {{tenantName}}',
    body: 'Hello {{name}},\n\nYour account is ready. Scan your table QR code to order and earn loyalty points.\n\nThe {{tenantName}} team',
  },
];

export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}
