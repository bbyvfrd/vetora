CREATE TABLE "control"."account" (
	"id" uuid PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control"."invitation" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control"."member" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "member_role_check" CHECK ("role" <> '' and string_to_array("role", ',') <@ array['manager', 'veterinarian', 'assistant', 'receptionist', 'groomer']::text[])
);
--> statement-breakpoint
CREATE TABLE "control"."organization" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"logo" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "control"."rate_limit" (
	"id" uuid PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control"."session" (
	"id" uuid PRIMARY KEY,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"impersonated_by" uuid,
	"active_organization_id" uuid
);
--> statement-breakpoint
CREATE TABLE "control"."user" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"username" text NOT NULL UNIQUE,
	"display_username" text,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"language" text NOT NULL,
	CONSTRAINT "user_language_check" CHECK ("language" in ('az', 'ru', 'en'))
);
--> statement-breakpoint
CREATE TABLE "control"."verification" (
	"id" uuid PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "control"."account" ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_idx" ON "control"."invitation" ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "control"."invitation" ("email");--> statement-breakpoint
CREATE INDEX "member_organization_id_idx" ON "control"."member" ("organization_id");--> statement-breakpoint
CREATE INDEX "member_user_id_idx" ON "control"."member" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_user_uidx" ON "control"."member" ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "control"."session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "control"."verification" ("identifier");--> statement-breakpoint
ALTER TABLE "control"."account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "control"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "control"."invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "control"."organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "control"."invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "control"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "control"."member" ADD CONSTRAINT "member_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "control"."organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "control"."member" ADD CONSTRAINT "member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "control"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "control"."organization" ADD CONSTRAINT "organization_id_practice_id_fkey" FOREIGN KEY ("id") REFERENCES "control"."practice"("id");--> statement-breakpoint
ALTER TABLE "control"."session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "control"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Hand written from here (spec 0002, "Security model"; spec #18, "Identity and access"): the app role gets what the
-- allowed Better Auth flows and the API's own routes write, nothing more. Sign in reads a login and its credential and
-- writes a session and the rate limiter's rows; sign out and expiry delete a session; provisioning creates a practice's
-- organization and its creator's membership; /api/me saves the language. A login's id, username and email never
-- change (the username plugin's immutableUsername, held here too), and no allowed flow deletes a login, an account, an
-- organization or a membership. The backup role reads every table for dumps; the migrator owns them all.
GRANT SELECT, INSERT ON TABLE "control"."user" TO vetora_app;
--> statement-breakpoint
GRANT UPDATE ("name", "email_verified", "image", "updated_at", "role", "banned", "ban_reason", "ban_expires", "language") ON TABLE "control"."user" TO vetora_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "control"."account" TO vetora_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "control"."session", "control"."verification", "control"."rate_limit" TO vetora_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "control"."organization", "control"."member" TO vetora_app;
--> statement-breakpoint
GRANT SELECT ON TABLE "control"."invitation" TO vetora_app;
--> statement-breakpoint
GRANT SELECT ON TABLE "control"."user", "control"."account", "control"."session", "control"."verification", "control"."rate_limit", "control"."organization", "control"."member", "control"."invitation" TO vetora_backup;
