// Integration tests always run against TEST_DATABASE_URL, never the dev database.
import { config } from "dotenv";

config({ quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must be set for integration tests");
if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
process.env.DATABASE_URL = url;
