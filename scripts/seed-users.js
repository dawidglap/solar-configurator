import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const MONGODB_URI =
  "mongodb+srv://mopen_db_user:AQDOG38xenuOpJuU@cluster0.0indfuy.mongodb.net/sola?retryWrites=true&w=majority";

const run = async () => {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to Mongo");

  const db = mongoose.connection.db;

  const users = db.collection("users");

  const companyId = new mongoose.Types.ObjectId("69612fbe9966bc81ea62d5d3");

  const passwordPlain = "Demo12345";
  const passwordHash = await bcrypt.hash(passwordPlain, 10);

  const now = new Date();

  // elimina utenti demo esistenti
  await users.deleteMany({
    email: {
      $in: [
        "superadmin@helionic.ch",
        "owner@demo-energie.ch",
        "admin@demo-energie.ch",
        "sales@demo-energie.ch",
        "installer@demo-energie.ch",
        "office@demo-energie.ch",
        "viewer@demo-energie.ch",
      ],
    },
  });

  console.log("Old demo users removed");

  await users.insertMany([
    {
      email: "superadmin@helionic.ch",
      firstName: "Platform",
      lastName: "Admin",
      passwordHash,
      isPlatformSuperAdmin: true,
      status: "active",
      memberships: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      email: "owner@demo-energie.ch",
      firstName: "Max",
      lastName: "Müller",
      passwordHash,
      isPlatformSuperAdmin: false,
      status: "active",
      memberships: [
        {
          companyId,
          role: "owner",
          isDefault: true,
          status: "active",
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      email: "admin@demo-energie.ch",
      firstName: "Anna",
      lastName: "Admin",
      passwordHash,
      isPlatformSuperAdmin: false,
      status: "active",
      memberships: [
        {
          companyId,
          role: "admin",
          isDefault: true,
          status: "active",
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      email: "sales@demo-energie.ch",
      firstName: "Sven",
      lastName: "Sales",
      passwordHash,
      isPlatformSuperAdmin: false,
      status: "active",
      memberships: [
        {
          companyId,
          role: "sales",
          isDefault: true,
          status: "active",
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      email: "installer@demo-energie.ch",
      firstName: "Ivan",
      lastName: "Installer",
      passwordHash,
      isPlatformSuperAdmin: false,
      status: "active",
      memberships: [
        {
          companyId,
          role: "installer",
          isDefault: true,
          status: "active",
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      email: "office@demo-energie.ch",
      firstName: "Olivia",
      lastName: "Office",
      passwordHash,
      isPlatformSuperAdmin: false,
      status: "active",
      memberships: [
        {
          companyId,
          role: "office",
          isDefault: true,
          status: "active",
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      email: "viewer@demo-energie.ch",
      firstName: "Viktor",
      lastName: "Viewer",
      passwordHash,
      isPlatformSuperAdmin: false,
      status: "active",
      memberships: [
        {
          companyId,
          role: "viewer",
          isDefault: true,
          status: "active",
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ]);

  console.log("✅ Demo users created");

  process.exit(0);
};

run();
