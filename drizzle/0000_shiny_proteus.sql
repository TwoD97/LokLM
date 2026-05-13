CREATE TABLE "recovery_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recovery_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" bigint DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT NOT NULL,
	"used_at" bigint
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"display_name" varchar(32) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" bigint DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT NOT NULL,
	CONSTRAINT "display_name_length" CHECK (length("users"."display_name") BETWEEN 3 AND 32)
);
--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_recovery_user" ON "recovery_codes" USING btree ("user_id") WHERE "recovery_codes"."used_at" IS NULL;