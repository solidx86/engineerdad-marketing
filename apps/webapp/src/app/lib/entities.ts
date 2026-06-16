import { ENTITY_NAMES, type EntityName } from "@engineerdad/store";

export function entityFromSlug(slug: string): EntityName | undefined {
  return ENTITY_NAMES.find(
    (e) => e.replace(/([A-Z])/g, "-$1").slice(1).toLowerCase() === slug,
  );
}

export function slugOf(entity: EntityName): string {
  return entity.replace(/([A-Z])/g, "-$1").slice(1).toLowerCase();
}
