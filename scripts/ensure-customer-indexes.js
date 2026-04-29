#!/usr/bin/env node

const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const customers = db.collection("customers");

    await customers.updateMany({ email: "" }, { $set: { email: null } });
    await customers.updateMany(
      { companyName: "" },
      { $set: { companyName: null } }
    );
    await customers.updateMany(
      { firstName: "" },
      { $set: { firstName: null } }
    );
    await customers.updateMany(
      { lastName: "" },
      { $set: { lastName: null } }
    );

    const indexes = [];

    indexes.push(
      await customers.createIndex(
        { companyId: 1, email: 1 },
        {
          name: "uniq_company_email_nonempty",
          unique: true,
          partialFilterExpression: {
            duplicateOfCustomerId: null,
            email: { $type: "string" },
          },
        }
      )
    );

    indexes.push(
      await customers.createIndex(
        { companyId: 1, firstName: 1, lastName: 1 },
        {
          name: "uniq_company_private_name_without_email",
          unique: true,
          partialFilterExpression: {
            duplicateOfCustomerId: null,
            type: "private",
            email: null,
            firstName: { $type: "string" },
            lastName: { $type: "string" },
          },
        }
      )
    );

    indexes.push(
      await customers.createIndex(
        { companyId: 1, companyName: 1 },
        {
          name: "uniq_company_company_name",
          unique: true,
          partialFilterExpression: {
            duplicateOfCustomerId: null,
            type: "company",
            companyName: { $type: "string" },
          },
        }
      )
    );

    console.log(JSON.stringify({ ok: true, indexes }, null, 2));
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
