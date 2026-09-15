import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(),
  geography: text("geography").notNull(),
  license: text("license").notNull(),
  reuseStatus: text("reuse_status").notNull(),
  accessMode: text("access_mode").notNull(),
  authorityRank: integer("authority_rank").notNull(),
  coverageTags: text("coverage_tags").notNull(),
  homepageUrl: text("homepage_url").notNull(),
  adapterStatus: text("adapter_status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_sources_authority_rank").on(table.authorityRank)]);

export const makes = sqliteTable("makes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  countryCode: text("country_code"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("uq_makes_name").on(table.name)]);

export const models = sqliteTable("models", {
  id: text("id").primaryKey(),
  makeId: text("make_id").notNull().references(() => makes.id),
  name: text("name").notNull(),
  vehicleType: text("vehicle_type").notNull().default("passenger_car"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("uq_models_make_name").on(table.makeId, table.name),
  index("idx_models_make_id").on(table.makeId),
]);

export const generations = sqliteTable("generations", {
  id: text("id").primaryKey(),
  modelId: text("model_id").notNull().references(() => models.id),
  code: text("code"),
  name: text("name"),
  startYear: integer("start_year"),
  endYear: integer("end_year"),
  facelift: integer("facelift", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_generations_model_id").on(table.modelId)]);

export const variants = sqliteTable("variants", {
  id: text("id").primaryKey(),
  modelId: text("model_id").notNull().references(() => models.id),
  generationId: text("generation_id").references(() => generations.id),
  market: text("market").notNull(),
  modelYear: integer("model_year"),
  trim: text("trim"),
  bodyStyle: text("body_style"),
  powertrain: text("powertrain"),
  transmission: text("transmission"),
  driveType: text("drive_type"),
  canonicalName: text("canonical_name").notNull(),
  completeness: integer("completeness").notNull().default(0),
  reviewStatus: text("review_status").notNull().default("identity_only"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_variants_market_year").on(table.market, table.modelYear),
  index("idx_variants_model_id").on(table.modelId),
  index("idx_variants_canonical_name").on(table.canonicalName),
]);

export const observations = sqliteTable("observations", {
  id: text("id").primaryKey(),
  variantId: text("variant_id").notNull().references(() => variants.id),
  attributeKey: text("attribute_key").notNull(),
  valueText: text("value_text"),
  valueNumber: real("value_number"),
  unit: text("unit"),
  sourceId: text("source_id").notNull().references(() => sources.id),
  sourceUrl: text("source_url"),
  market: text("market").notNull(),
  method: text("method").notNull(),
  effectiveFrom: text("effective_from"),
  effectiveTo: text("effective_to"),
  retrievedAt: text("retrieved_at").notNull(),
  confidence: integer("confidence").notNull(),
  rawValue: text("raw_value"),
  checksum: text("checksum"),
}, (table) => [
  index("idx_observations_variant_attribute").on(table.variantId, table.attributeKey),
  index("idx_observations_source_id").on(table.sourceId),
]);

export const sourceCrosswalks = sqliteTable("source_crosswalks", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  externalId: text("external_id").notNull(),
  market: text("market"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("uq_crosswalk_source_external").on(table.sourceId, table.entityType, table.externalId),
  index("idx_crosswalk_entity").on(table.entityType, table.entityId),
]);

export const ingestionRuns = sqliteTable("ingestion_runs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id),
  adapter: text("adapter").notNull(),
  status: text("status").notNull(),
  scope: text("scope").notNull(),
  fetched: integer("fetched").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  rejected: integer("rejected").notNull().default(0),
  error: text("error"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
}, (table) => [index("idx_ingestion_runs_started_at").on(table.startedAt)]);

export const conflicts = sqliteTable("conflicts", {
  id: text("id").primaryKey(),
  variantId: text("variant_id").notNull().references(() => variants.id),
  attributeKey: text("attribute_key").notNull(),
  observationAId: text("observation_a_id").notNull().references(() => observations.id),
  observationBId: text("observation_b_id").notNull().references(() => observations.id),
  status: text("status").notNull().default("open"),
  resolutionNote: text("resolution_note"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
}, (table) => [index("idx_conflicts_status").on(table.status)]);
