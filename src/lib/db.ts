import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is not defined");
}

const MONGODB_URI = uri;

const options = {
  maxPoolSize: 5,
  serverSelectionTimeoutMS: 10000,
  family: 4 as const,
};

type MongoCache = {
  client: MongoClient | null;
  promise: Promise<MongoClient> | null;
};

declare global {
  var _mongoCache: MongoCache | undefined;
}

const cache = globalThis._mongoCache ?? {
  client: null,
  promise: null,
};

if (!globalThis._mongoCache) {
  globalThis._mongoCache = cache;
}

function isDevLoggingEnabled() {
  return process.env.NODE_ENV === "development";
}

export async function getMongoClient() {
  if (cache.client) {
    if (isDevLoggingEnabled()) {
      console.log("[db] reusing cached MongoDB client");
    }
    return cache.client;
  }

  if (!cache.promise) {
    if (isDevLoggingEnabled()) {
      console.log("[db] creating new MongoDB connection");
    }

    const client = new MongoClient(MONGODB_URI, options);
    cache.promise = client.connect();
  } else if (isDevLoggingEnabled()) {
    console.log("[db] awaiting existing MongoDB connection promise");
  }

  cache.client = await cache.promise;
  return cache.client;
}

export async function getDb() {
  const client = await getMongoClient();
  return client.db();
}
