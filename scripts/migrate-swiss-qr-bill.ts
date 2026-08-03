import "dotenv/config";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";

async function main() {
  const uri = process.env.MONGODB_URI;
  assert.ok(uri, "Missing MONGODB_URI");

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const companies = db.collection("companies");
    const customers = db.collection("customers");
    const invoices = db.collection("invoices");

    const [companyResult, customerResult, invoiceReferenceResult, invoiceTypeResult] =
      await Promise.all([
        companies.updateMany(
          { qrBill: { $exists: false } },
          { $set: { qrBill: {} } },
        ),
        customers.updateMany(
          { $or: [{ country: { $exists: false } }, { country: null }, { country: "" }] },
          { $set: { country: "CH" } },
        ),
        invoices.updateMany(
          { qrReference: { $exists: false } },
          { $set: { qrReference: null } },
        ),
        invoices.updateMany(
          { qrReferenceType: { $exists: false } },
          { $set: { qrReferenceType: null } },
        ),
      ]);

    await invoices.createIndex(
      { companyId: 1, qrReference: 1 },
      {
        name: "uniq_company_qr_reference",
        unique: true,
        partialFilterExpression: { qrReference: { $type: "string" } },
      },
    );

    console.log(
      [
        "Swiss QR bill migration complete.",
        `companies=${companyResult.modifiedCount}`,
        `customers=${customerResult.modifiedCount}`,
        `invoiceReferences=${invoiceReferenceResult.modifiedCount}`,
        `invoiceReferenceTypes=${invoiceTypeResult.modifiedCount}`,
      ].join(" "),
    );
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("migrate-swiss-qr-bill failed:", error);
  process.exit(1);
});
