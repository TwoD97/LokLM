CREATE TABLE "quiz_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"deck_id" integer NOT NULL,
	"started_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT) NOT NULL,
	"finished_at" bigint,
	"score" integer,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_decks" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"document_ids" jsonb NOT NULL,
	"question_count" integer NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"error" text,
	"language" text NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"deck_id" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"stem" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_index" integer NOT NULL,
	"explanation" text NOT NULL,
	"source_chunk_ids" jsonb NOT NULL,
	"theme_title" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_deck_id_quiz_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."quiz_decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_decks" ADD CONSTRAINT "quiz_decks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_deck_id_quiz_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."quiz_decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_quiz_attempts_deck" ON "quiz_attempts" USING btree ("deck_id");--> statement-breakpoint
CREATE INDEX "idx_quiz_decks_workspace" ON "quiz_decks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_quiz_questions_deck" ON "quiz_questions" USING btree ("deck_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_quiz_questions_deck_ordinal" ON "quiz_questions" USING btree ("deck_id","ordinal");