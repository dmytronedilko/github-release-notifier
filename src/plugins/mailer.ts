import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrevoClient } from '@getbrevo/brevo';
import pug from 'pug';

import { logger } from '../logger.js';

export interface MailerConfig {
  apiKey: string;
  senderName: string;
  senderEmail: string;
  baseUrl: string;
}

export interface Mailer {
  sendConfirmationEmail(email: string, token: string): Promise<void>;
  sendReleaseEmail(email: string, repo: string, tag: string, token: string): Promise<void>;
}

const colors = {
  bg: '#0d1117',
  surface: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#7d8590',
  accent: '#2f81f7',
  accentHover: '#388bfd',
  success: '#3fb950',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(__dirname, '../../views');

const renderConfirmation = pug.compileFile(join(VIEWS_DIR, 'emails/confirmation.pug'), {
  basedir: VIEWS_DIR,
});

const renderRelease = pug.compileFile(join(VIEWS_DIR, 'emails/release.pug'), {
  basedir: VIEWS_DIR,
});

export function createMailer(config: MailerConfig): Mailer {
  const brevo = new BrevoClient({ apiKey: config.apiKey });
  const sender = { name: config.senderName, email: config.senderEmail };
  const baseUrl = config.baseUrl.replace(/\/+$/, '');

  return {
    async sendConfirmationEmail(email: string, token: string): Promise<void> {
      const confirmUrl = `${baseUrl}/confirm/${token}`;
      await brevo.transactionalEmails.sendTransacEmail({
        sender,
        to: [{ email }],
        subject: 'Confirm your GitHub Release Notification subscription',
        htmlContent: renderConfirmation({ colors, confirmUrl }),
        textContent: `Confirm your subscription: ${confirmUrl}`,
      });
    },

    async sendReleaseEmail(email: string, repo: string, tag: string, token: string): Promise<void> {
      const [owner, repoName] = repo.split('/');
      const releaseUrl = `https://github.com/${repo}/releases/tag/${tag}`;
      const unsubscribeUrl = `${baseUrl}/unsubscribe/${token}`;
      await brevo.transactionalEmails.sendTransacEmail({
        sender,
        to: [{ email }],
        subject: `New release: ${repo} ${tag}`,
        htmlContent: renderRelease({ colors, owner, repoName, tag, releaseUrl, unsubscribeUrl }),
        textContent: `New release ${tag} for ${repo}: ${releaseUrl}\n\nUnsubscribe: ${unsubscribeUrl}`,
      });
    },
  };
}

export function createMockMailer(): Mailer {
  return {
    sendConfirmationEmail(email: string, token: string): Promise<void> {
      logger.info({ email, token }, 'Mock confirmation email');
      return Promise.resolve();
    },
    sendReleaseEmail(email: string, repo: string, tag: string, token: string): Promise<void> {
      logger.info({ email, repo, tag, token }, 'Mock release email');
      return Promise.resolve();
    },
  };
}
