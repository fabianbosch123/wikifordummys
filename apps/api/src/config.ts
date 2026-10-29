import { ATTACHMENT_DEFAULT_MAX_MB } from "@wiki/shared";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/**
 * Geheimnisse, die nicht zufällig erzeugt wurden: Platzhalter aus .env.example, Test- und Beispielwerte
 * oder Zeichenfolgen mit wenigen verschiedenen Zeichen. `openssl rand -hex 32` besteht immer.
 */
export function isWeakSecret(value: string): boolean {
  return (
    /^bitte-|secret|passw|example|changeme/i.test(value) ||
    new Set(value).size < 12
  );
}

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3001),
    /** Öffentliche Adresse des Wikis, z. B. https://wiki.example.de (für Links und Origin-Prüfung) */
    APP_ORIGIN: z.string().url(),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    /** 32 Byte als Base64 oder Hex; verschlüsselt TOTP-Geheimnisse (S2) */
    ENCRYPTION_KEY: z.string().min(32),
    /** Mindestens 32 Zeichen; Schlüssel für HMACs (Wiederherstellungscodes, Rate-Limit-Schlüssel) */
    SESSION_SECRET: z.string().min(32),
    /** false nur für lokale Entwicklung über http */
    COOKIE_SECURE: bool.prefault("true"),
    /** Anzahl vertrauenswürdiger Proxys vor der API (Caddy = 1) */
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default("wikifordummys <wiki@localhost>"),
    /** Rate-Limits (S3) */
    RATE_LOGIN_PER_MINUTE: z.coerce.number().int().positive().default(5),
    /** Anmeldeversuche je Konto und Minute über alle IPs zusammen; großzügig, damit Fremde ein Konto nicht aussperren (SEC-002) */
    RATE_LOGIN_ACCOUNT_PER_MINUTE: z.coerce
      .number()
      .int()
      .positive()
      .default(30),
    RATE_RESET_PER_HOUR: z.coerce.number().int().positive().default(3),
    RATE_API_PER_MINUTE: z.coerce.number().int().positive().default(300),
    /** MCP-Server: Aufrufe je Token und Minute sowie ändernde Aufrufe je Token und Stunde */
    RATE_MCP_PER_MINUTE: z.coerce.number().int().positive().default(120),
    RATE_MCP_WRITES_PER_HOUR: z.coerce.number().int().positive().default(120),
    /** OAuth für den MCP-Server: Hosts, zu denen nach der Zustimmung zurückgeleitet werden darf (https), kommagetrennt */
    OAUTH_REDIRECT_HOSTS: z.string().default("claude.ai,claude.com"),
    /** Verzeichnis für Anhänge, außerhalb des Web-Roots (S7); im Container ein eigenes Volume */
    ATTACHMENTS_DIR: z.string().min(1).default("/var/lib/wiki/attachments"),
    /** Höchstgröße eines Anhangs in MiB (S7) */
    ATTACHMENT_MAX_MB: z.coerce
      .number()
      .int()
      .min(1)
      .max(1024)
      .default(ATTACHMENT_DEFAULT_MAX_MB),
    /** Unter so viel freiem Platz (MiB) im Anhang-Verzeichnis nimmt die API keine Dateien mehr an (SEC-003) */
    ATTACHMENT_MIN_FREE_MB: z.coerce.number().int().min(0).default(2048),
    /** Höchstens so viele MiB Anhänge und Fassungen je Benutzer in 24 Stunden (SEC-003) */
    ATTACHMENT_QUOTA_MB_PER_DAY: z.coerce.number().int().min(1).default(2048),
    /** Uploads (Anhänge und Fassungen) je Benutzer und Stunde */
    RATE_UPLOADS_PER_HOUR: z.coerce.number().int().positive().default(300),
    /** Office-Editor (Euro-Office) zum Ansehen und Bearbeiten von Office-Anhängen */
    OFFICE_ENABLED: bool.prefault("false"),
    /** Gemeinsames JWT-Geheimnis mit dem Editor-Server, mindestens 32 Zeichen */
    OFFICE_JWT_SECRET: z.string().optional(),
    /** Adresse des Editor-Servers im internen Docker-Netz; von dort holt die API gespeicherte Fassungen */
    OFFICE_INTERNAL_URL: z.string().url().default("http://office"),
    /** Adresse, unter der der Editor-Server die API erreicht (Datei abholen, Rückruf nach dem Speichern) */
    OFFICE_API_URL: z.string().url().default("http://api:3001"),
    /** Zeichnungen mit draw.io (Dienst drawio unter /draw/); ohne bleiben vorhandene Zeichnungen sichtbar, aber nicht bearbeitbar */
    DRAWIO_ENABLED: bool.prefault("false"),
    /** Argon2-Kosten; nur in Tests herabsetzen */
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(65536),
    ARGON2_TIME_COST: z.coerce.number().int().min(1).default(3),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "muss in Produktion true sein",
      });
    }
    if (env.OFFICE_ENABLED && (env.OFFICE_JWT_SECRET ?? "").length < 32) {
      ctx.addIssue({
        code: "custom",
        path: ["OFFICE_JWT_SECRET"],
        message: "mindestens 32 Zeichen, wenn OFFICE_ENABLED gesetzt ist",
      });
    }
    if (env.NODE_ENV === "production") {
      const secrets = {
        SESSION_SECRET: env.SESSION_SECRET,
        OFFICE_JWT_SECRET: env.OFFICE_ENABLED
          ? env.OFFICE_JWT_SECRET
          : undefined,
      };
      for (const [key, value] of Object.entries(secrets)) {
        if (value && isWeakSecret(value)) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message:
              "Platzhalter oder Testwert; mit `openssl rand -hex 32` erzeugen",
          });
        }
      }
    }
    if (
      env.NODE_ENV === "production" &&
      !env.APP_ORIGIN.startsWith("https://")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: "muss in Produktion mit https:// beginnen",
      });
    }
  });

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Ungültige Konfiguration:\n${issues}`);
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol("APP_CONFIG");
