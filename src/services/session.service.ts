import { eq, sql } from 'drizzle-orm';
import { db, type Db } from '../db';
import { userSessions, type UserSession } from '../db/schema';

/** Persists which message is each user's single "screen", so it survives a restart. */
export class SessionService {
  constructor(private readonly db: Db) {}

  async getSession(telegramId: number): Promise<UserSession | undefined> {
    const [session] = await this.db.select().from(userSessions).where(eq(userSessions.telegramId, telegramId));
    return session;
  }

  async saveSession(telegramId: number, messageId: number, screen: string): Promise<void> {
    await this.db
      .insert(userSessions)
      .values({ telegramId, messageId, screen })
      .onConflictDoUpdate({
        target: userSessions.telegramId,
        set: { messageId, screen, updatedAt: sql`CURRENT_TIMESTAMP` },
      });
  }

  async clearSession(telegramId: number): Promise<void> {
    await this.db.delete(userSessions).where(eq(userSessions.telegramId, telegramId));
  }
}

export const sessionService = new SessionService(db);
