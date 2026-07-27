import type { Db } from "mongodb";

let ensureNotificationIndexesPromise: Promise<void> | null = null;

export function getNotificationsCollection(db: Db) {
  return db.collection("notifications");
}

export async function ensureNotificationIndexes(db: Db) {
  if (ensureNotificationIndexesPromise) return ensureNotificationIndexesPromise;

  ensureNotificationIndexesPromise = Promise.all([
    getNotificationsCollection(db).createIndex({ userId: 1, createdAt: -1 }),
    getNotificationsCollection(db).createIndex({ companyId: 1, userId: 1, readAt: 1, createdAt: -1 }),
    getNotificationsCollection(db).createIndex({ companyId: 1, type: 1, createdAt: -1 }),
  ])
    .then(() => undefined)
    .catch((error) => {
      ensureNotificationIndexesPromise = null;
      throw error;
    });

  return ensureNotificationIndexesPromise;
}

