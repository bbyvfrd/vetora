-- The species seed (#21; spec 0002, "Data model sketch": species; OPEN-11): a data migration, so a practice provisioned
-- after it and one migrated from before it hold the same rows, audited as this migration (docs/database.md, "Actor and
-- audit": a writing migration names its own folder). Dog and cat are clinically supported, the rest recorded only;
-- the names are the design system glossary's (Patient details). A rerun inserts nothing.
select set_config('app.migration', '20261027073344_species_seed', true);
--> statement-breakpoint
INSERT INTO "species" ("code", "name_az", "name_ru", "name_en", "clinically_supported", "sort") VALUES
  ('dog', 'İt', 'Собака', 'Dog', true, 1),
  ('cat', 'Pişik', 'Кошка', 'Cat', true, 2),
  ('rabbit', 'Dovşan', 'Кролик', 'Rabbit', false, 3),
  ('bird', 'Quş', 'Птица', 'Bird', false, 4),
  ('reptile', 'Sürünən', 'Рептилия', 'Reptile', false, 5),
  ('rodent', 'Gəmirici', 'Грызун', 'Rodent', false, 6),
  ('other', 'Digər', 'Другое', 'Other', false, 7)
ON CONFLICT ("code") DO NOTHING;
