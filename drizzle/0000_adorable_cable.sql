CREATE TABLE "chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"context_prefix" text,
	"token_count" integer,
	"page_from" integer,
	"page_to" integer,
	"embedding" vector(1024),
	"text_search" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"chunk_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"score" real,
	"span_start" integer,
	"span_end" integer,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"title" text,
	"active_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"tag" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"title" text NOT NULL,
	"source_path" text NOT NULL,
	"mime_type" text,
	"byte_size" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"token_count" bigint DEFAULT 0 NOT NULL,
	"added_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chunks_document" ON "chunks" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_chunks_doc_ordinal" ON "chunks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "idx_citations_message" ON "citations" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_citations_chunk" ON "citations" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "idx_document_tags_doc" ON "document_tags" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_document_tags_tag" ON "document_tags" USING btree ("tag");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_document_tags_doc_tag" ON "document_tags" USING btree ("document_id","tag");--> statement-breakpoint
CREATE INDEX "idx_documents_workspace" ON "documents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_messages_conv" ON "messages" USING btree ("conversation_id");