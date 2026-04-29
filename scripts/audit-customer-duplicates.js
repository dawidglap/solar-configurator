#!/usr/bin/env node

const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");

dotenv.config({ path: ".env.local" });
dotenv.config();

function safeString(v) {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeEmail(v) {
  return safeString(v).toLowerCase();
}

function asDate(value) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function compareDocs(a, b) {
  const aDate = asDate(a.createdAt);
  const bDate = asDate(b.createdAt);

  if (aDate && bDate && aDate.getTime() !== bDate.getTime()) {
    return aDate.getTime() - bDate.getTime();
  }

  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;

  return String(a._id).localeCompare(String(b._id));
}

function buildGroups(docs, keyName, resolver) {
  const groups = new Map();

  for (const doc of docs) {
    if (doc.duplicateOfCustomerId) continue;
    const key = resolver(doc);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }

  return [...groups.entries()]
    .map(([key, items]) => ({
      kind: keyName,
      key,
      items: items.sort(compareDocs),
    }))
    .filter((group) => group.items.length > 1);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  const mark = process.argv.includes("--mark");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const customers = db.collection("customers");

    const docs = await customers
      .find(
        {},
        {
          projection: {
            _id: 1,
            companyId: 1,
            type: 1,
            email: 1,
            firstName: 1,
            lastName: 1,
            companyName: 1,
            createdAt: 1,
            duplicateOfCustomerId: 1,
          },
        }
      )
      .toArray();

    const emailGroups = buildGroups(docs, "email", (doc) => {
      const email = normalizeEmail(doc.email);
      if (!doc.companyId || !email) return null;
      return `company:${doc.companyId}::email:${email}`;
    });

    const privateNameGroups = buildGroups(docs, "privateName", (doc) => {
      if (doc.type !== "private") return null;
      if (normalizeEmail(doc.email)) return null;
      const firstName = safeString(doc.firstName);
      const lastName = safeString(doc.lastName);
      if (!doc.companyId || !firstName || !lastName) return null;
      return `company:${doc.companyId}::person:${firstName}::${lastName}`;
    });

    const companyNameGroups = buildGroups(docs, "companyName", (doc) => {
      if (doc.type !== "company") return null;
      const companyName = safeString(doc.companyName);
      if (!doc.companyId || !companyName) return null;
      return `company:${doc.companyId}::company:${companyName}`;
    });

    const duplicateGroups = [
      ...emailGroups,
      ...privateNameGroups,
      ...companyNameGroups,
    ];

    const summary = duplicateGroups.map((group) => {
      const [canonical, ...duplicates] = group.items;
      return {
        kind: group.kind,
        key: group.key,
        canonicalId: String(canonical._id),
        duplicateIds: duplicates.map((doc) => String(doc._id)),
        count: group.items.length,
      };
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          groups: summary.length,
          duplicates: summary,
        },
        null,
        2
      )
    );

    if (!mark || summary.length === 0) {
      return;
    }

    let marked = 0;
    for (const group of duplicateGroups) {
      const [canonical, ...duplicates] = group.items;

      for (const doc of duplicates) {
        await customers.updateOne(
          { _id: doc._id, duplicateOfCustomerId: { $exists: false } },
          {
            $set: {
              duplicateOfCustomerId: String(canonical._id),
              duplicateReason: group.kind,
              duplicateMarkedAt: new Date(),
            },
          }
        );
        marked += 1;
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          marked,
        },
        null,
        2
      )
    );
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error?.message || "Unknown error",
      },
      null,
      2
    )
  );
  process.exit(1);
});
