import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { validateExternalServicesCatalogFile, type ExternalServiceDefinition } from "./schema";

export function loadExternalServicesCatalog(
  catalogPath = path.join(process.cwd(), "EXTERNAL_SERVICES_CATALOG_V0_1.yaml")
): ExternalServiceDefinition[] {
  const parsed = parse(readFileSync(catalogPath, "utf8")) as unknown;
  return validateExternalServicesCatalogFile(parsed);
}

export function enabledExternalServices(services: ExternalServiceDefinition[]): ExternalServiceDefinition[] {
  return services.filter((service) => service.enabled === true);
}
