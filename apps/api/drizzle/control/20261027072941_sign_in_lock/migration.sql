CREATE TABLE "control"."sign_in_lock" (
	"username" text PRIMARY KEY,
	"failures" integer NOT NULL,
	"first_failed_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
-- Hand written from here (spec 0002, "Security model"; spec #18, "Identity and access"; #20): the app role counts the
-- sign ins, deletes a row on a success, and unlock-login deletes one; the backup role reads it for dumps.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "control"."sign_in_lock" TO vetora_app;
--> statement-breakpoint
GRANT SELECT ON TABLE "control"."sign_in_lock" TO vetora_backup;
