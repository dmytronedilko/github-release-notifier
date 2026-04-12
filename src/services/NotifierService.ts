import { eq, and } from 'drizzle-orm';

import { Db } from '../db/index.js';
import { subscriptions } from '../db/schema.js';
import { notificationsSentTotal } from '../metrics.js';
import { Mailer } from '../plugins/mailer.js';

export interface Notifier {
  notifySubscribers(repo: string, newTag: string): Promise<void>;
}

export class NotifierService implements Notifier {
  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer,
  ) {}

  async notifySubscribers(repo: string, newTag: string): Promise<void> {
    const rows = await this.db
      .select({ email: subscriptions.email, token: subscriptions.token })
      .from(subscriptions)
      .where(and(eq(subscriptions.repo, repo), eq(subscriptions.confirmed, true)));

    const NOTIFY_CONCURRENCY = 10;
    for (let i = 0; i < rows.length; i += NOTIFY_CONCURRENCY) {
      const batch = rows.slice(i, i + NOTIFY_CONCURRENCY);
      await Promise.all(
        batch.map(async (row) => {
          await this.mailer.sendReleaseEmail(row.email, repo, newTag, row.token);
          notificationsSentTotal.inc();
        }),
      );
    }
  }
}
