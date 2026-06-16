import type { ListConfig } from "../types";
import type { EntityName } from "@engineerdad/store";
import { defaultList } from "./default";
import { creativeVariantsList } from "./creative-variants";
import { hypothesesList } from "./hypotheses";
import { experimentsList } from "./experiments";
import { distributionsList } from "./distributions";
import { briefsList } from "./briefs";
import { scriptsList } from "./scripts";

const MAP: Partial<Record<EntityName, ListConfig>> = {
  Briefs: briefsList,
  Scripts: scriptsList,
  CreativeVariants: creativeVariantsList,
  Hypotheses: hypothesesList,
  Experiments: experimentsList,
  Distributions: distributionsList,
};

export function listConfigFor(entity: EntityName): ListConfig {
  return MAP[entity] ?? defaultList;
}
