/**
 * Singleton MongoDB client for Next.js API routes.
 * Reuses the connection across hot-reloads in dev and across requests in prod.
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI!;
if (!uri) throw new Error("MONGODB_URI env var is not set");

const DB_NAME = process.env.MONGODB_DATABASE ?? "pdf-engine";

declare global {
    // eslint-disable-next-line no-var
    var _mongoClient: MongoClient | undefined;
}

let client: MongoClient;

if (process.env.NODE_ENV === "development") {
    if (!global._mongoClient) {
        global._mongoClient = new MongoClient(uri);
    }
    client = global._mongoClient;
} else {
    client = new MongoClient(uri);
}

export async function getDb() {
    await client.connect();
    return client.db(DB_NAME);
}
