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
  const demoUsers = [
    {
      email: "superadmin@helionic.ch",
      firstName: "Platform",
      lastName: "Admin",
      passwordHash,
      isPlatformSuperAdmin: true,
      status: "active",
      executionRoles: [],
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
      executionRoles: [],
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
      executionRoles: [],
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
      executionRoles: [],
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
      executionRoles: [],
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
      executionRoles: [],
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
      executionRoles: [],
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
    {
      email: "montage1@demo-energie.ch",
      firstName: "Marco",
      lastName: "Monteur",
      passwordHash,
      isPlatformSuperAdmin: false,
      status: "active",
      executionRoles: ["montage"],
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
      email: "montage2@demo-energie.ch",
      firstName: "Lukas",
      lastName: "Lehner",
      passwordHash,
      isPlatformSuperAdmin: false,
      status: "active",
      executionRoles: ["montage"],
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
      email: "elektro1@demo-energie.ch",
      firstName: "Erik",
      lastName: "Elektriker",
      passwordHash,
      isPlatformSuperAdmin: false,
      status: "active",
      executionRoles: ["elektro"],
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
      email: "elektro2@demo-energie.ch",
      firstName: "Pia",
      lastName: "Power",
      passwordHash,
      isPlatformSuperAdmin: false,
      status: "active",
      executionRoles: ["montage", "elektro"],
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
  ];

  const result = await users.bulkWrite(
    demoUsers.map((user) => ({
      updateOne: {
        filter: { email: user.email },
        update: {
          $set: {
            firstName: user.firstName,
            lastName: user.lastName,
            passwordHash: user.passwordHash,
            isPlatformSuperAdmin: user.isPlatformSuperAdmin,
            status: user.status,
            executionRoles: user.executionRoles,
            memberships: user.memberships,
            updatedAt: user.updatedAt,
          },
          $setOnInsert: {
            email: user.email,
            createdAt: user.createdAt,
          },
        },
        upsert: true,
      },
    }))
  );

  console.log("✅ Demo users upserted", {
    matched: result.matchedCount,
    modified: result.modifiedCount,
    upserted: result.upsertedCount,
  });

  process.exit(0);
};

run();
