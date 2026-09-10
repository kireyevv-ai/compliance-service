import { z } from "zod";

export const providerScopeSchema = z.enum([
  "RU_PROVIDER",
  "RU_MARKET_PROVIDER",
  "FOREIGN_PROVIDER",
  "MIXED_REQUIRES_CONTRACT_CHECK"
]);

export const externalServiceConfidenceSchema = z.enum(["HIGH", "MEDIUM", "CANDIDATE"]);

export const externalServiceSchema = z.object({
  id: z.string().min(1).optional(),
  service_id: z.string().min(1).optional(),
  name: z.string().min(1),
  domains: z.array(z.string().min(1)).min(1),
  category: z.string().min(1),
  provider: z.string().min(1),
  provider_scope: providerScopeSchema.optional(),
  enabled: z.boolean().optional(),
  confidence: externalServiceConfidenceSchema.optional(),
  path_hints: z.array(z.string().startsWith("/")).optional(),
  source: z.string().optional(),
  note: z.string().optional(),
  jurisdiction_notes: z.string().optional(),
  data_notes: z.string().optional(),
  test_only: z.boolean().optional()
}).transform((service) => ({
  ...service,
  service_id: service.service_id ?? service.id ?? "",
  id: service.id ?? service.service_id ?? ""
})).pipe(
  z.object({
    id: z.string().min(1),
    service_id: z.string().min(1),
    name: z.string().min(1),
    domains: z.array(z.string().min(1)).min(1),
    category: z.string().min(1),
    provider: z.string().min(1),
    provider_scope: providerScopeSchema.default("RU_PROVIDER"),
    enabled: z.boolean().default(false),
    confidence: externalServiceConfidenceSchema.default("CANDIDATE"),
    path_hints: z.array(z.string().startsWith("/")).optional(),
    source: z.string().optional(),
    note: z.string().optional(),
    jurisdiction_notes: z.string().optional(),
    data_notes: z.string().optional(),
    test_only: z.boolean().optional()
  })
);

export const externalServicesCatalogSchema = z.array(externalServiceSchema);

export const externalServicesCatalogFileSchema = z.object({
  catalog: z.object({
    name: z.string(),
    entries: z.number().optional(),
    enabled_entries: z.number().optional()
  }),
  services: externalServicesCatalogSchema
});

export type ExternalServiceDefinition = z.infer<typeof externalServiceSchema>;
export type ProviderScope = z.infer<typeof providerScopeSchema>;
export type ExternalServiceConfidence = z.infer<typeof externalServiceConfidenceSchema>;

export function validateExternalService(input: unknown): ExternalServiceDefinition {
  return externalServiceSchema.parse(input);
}

export function validateExternalServicesCatalog(input: unknown): ExternalServiceDefinition[] {
  return externalServicesCatalogSchema.parse(input);
}

export function validateExternalServicesCatalogFile(input: unknown): ExternalServiceDefinition[] {
  const catalog = externalServicesCatalogFileSchema.parse(input);
  validateCatalogSemantics(catalog.services);
  return catalog.services;
}

export function validateCatalogSemantics(services: ExternalServiceDefinition[]): void {
  const seenIds = new Set<string>();

  for (const service of services) {
    if (seenIds.has(service.service_id)) {
      throw new Error(`Duplicate external service id: ${service.service_id}`);
    }
    seenIds.add(service.service_id);

    if (service.enabled && service.confidence === "CANDIDATE") {
      throw new Error(`Enabled external service cannot use CANDIDATE confidence: ${service.service_id}`);
    }

    if (service.enabled && service.domains.length === 0) {
      throw new Error(`Enabled external service requires at least one domain: ${service.service_id}`);
    }
  }
}
