ALTER TABLE "stock_doc_lines" ADD COLUMN "pair_line_no" integer;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD COLUMN "pair_move_id" uuid;--> statement-breakpoint
CREATE INDEX "stock_moves_pair_idx" ON "stock_moves" USING btree ("pair_move_id") WHERE "pair_move_id" is not null;