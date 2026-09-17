// HOSTNAME is commonly set to the machine name by the shell. Bind locally.
process.env.HOSTNAME = "127.0.0.1";
await import("../apps/web/.next/standalone/apps/web/server.js");
