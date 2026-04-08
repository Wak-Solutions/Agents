import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

const PgSession = connectPgSimple(session);
const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare global {
  namespace Express {
    interface Session {
      authenticated?: boolean;
    }
  }
}

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    agentId?: number | null;
    companyId?: number | null;
    role?: string;
    agentName?: string;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Trust Railway's reverse proxy so session cookies work correctly on HTTPS
app.set('trust proxy', 1);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

// Structured logger used by the request pipeline and error handler.
// Route modules use createLogger() from lib/logger.ts directly.
function slog(level: string, module: string, message: string, context?: string) {
  const line = context ? `${message} — ${context}` : message;
  const fn = level === 'ERROR' ? console.error : console.log;
  fn(`[${level}] [${module}] ${line}`);
}

function validateStartupEnv() {
  const missing = ["DATABASE_URL"].filter(
    (key) => !process.env[key],
  );

  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    missing.push("SESSION_SECRET");
  }

  if (missing.length === 0) {
    return;
  }

  console.error("Startup configuration error:");
  for (const key of missing) {
    console.error(`- Missing required environment variable: ${key}`);
  }
  process.exit(1);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  validateStartupEnv();

  // Import the DB pool and wire up persistent session storage.
  // connect-pg-simple stores sessions in PostgreSQL so they survive server restarts.
  // MemoryStore (previous) wiped sessions on every Railway deploy, causing 401s.
  const { pool } = await import("./db");

  app.use(session({
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days, rolling
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
    store: new PgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    rolling: true,          // reset expiry on every request
    resave: false,
    saveUninitialized: false,
    secret: process.env.SESSION_SECRET || "wak-dashboard-secret",
  }));

  try {
    // Session table for connect-pg-simple — must exist before any session op
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid"    varchar      NOT NULL COLLATE "default",
        "sess"   json         NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);
  } catch (err) {
    slog('WARN', 'db', 'Session table migration error (continuing)', String(err));
  }

  try {
    await pool.query(`
      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS media_type    TEXT,
        ADD COLUMN IF NOT EXISTS media_url     TEXT,
        ADD COLUMN IF NOT EXISTS transcription TEXT;

      CREATE TABLE IF NOT EXISTS voice_notes (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        audio_data BYTEA       NOT NULL,
        mime_type  TEXT        NOT NULL DEFAULT 'audio/ogg',
        company_id INTEGER     DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id           SERIAL      PRIMARY KEY,
        phone_number TEXT        NOT NULL,
        name         TEXT,
        source       TEXT        NOT NULL DEFAULT 'manual',
        company_id   INTEGER     DEFAULT 1,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (phone_number, company_id)
      );
      CREATE INDEX IF NOT EXISTS contacts_phone_idx ON contacts (phone_number);
    `);
    slog('INFO', 'db', 'Startup migrations applied successfully');
  } catch (err) {
    slog('WARN', 'db', 'Migration error (continuing)', String(err));
  }

  // ── Additive column migrations (safe to run repeatedly) ─────────────────
  try {
    await pool.query(`ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS company_id INTEGER DEFAULT 1`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_id INTEGER DEFAULT 1`);
    // Drop the old single-column unique constraint and replace with per-company composite unique.
    // The default PostgreSQL name for UNIQUE(phone_number) on the contacts table is contacts_phone_number_key.
    await pool.query(`ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_number_key`);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'contacts_phone_company_key'
        ) THEN
          ALTER TABLE contacts ADD CONSTRAINT contacts_phone_company_key UNIQUE (phone_number, company_id);
        END IF;
      END;
      $$
    `);
    slog('INFO', 'db', 'Column migrations applied successfully');
  } catch (err) {
    slog('WARN', 'db', 'Migration error (continuing)', String(err));
  }

  const [{ registerRoutes }, { serveStatic }] = await Promise.all([
    import("./routes"),
    import("./static"),
  ]);

  await registerRoutes(httpServer, app);

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    slog('ERROR', 'express', 'Unhandled error', `method: ${req.method}, path: ${req.path}, status: ${status}, error: ${message}`);
    if (process.env.NODE_ENV !== 'production') console.error(err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen(
    {
      port,
      host,
    },
    () => {
      log(`serving on http://${host}:${port}`);
    },
  );
})();
