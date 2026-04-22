import { desc, eq } from "drizzle-orm";

import type { AppDb } from "../db/client";
import { adminInvites, session, user } from "../db/schema";

export async function listUsers(db: AppDb) {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      locale: user.locale,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt));
}

export async function toggleUserActive(db: AppDb, userId: string, isActive: boolean) {
  await db
    .update(user)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(user.id, userId));

  if (!isActive) {
    await db.delete(session).where(eq(session.userId, userId));
  }
}

export async function deleteUser(db: AppDb, userId: string) {
  await db.delete(user).where(eq(user.id, userId));
}

export async function listAllInvites(db: AppDb) {
  return db
    .select()
    .from(adminInvites)
    .orderBy(desc(adminInvites.createdAt));
}

export async function deleteInvite(db: AppDb, inviteId: string) {
  await db.delete(adminInvites).where(eq(adminInvites.id, inviteId));
}
