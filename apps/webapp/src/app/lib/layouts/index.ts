import type { EntityLayout } from "../types";
import type { EntityName } from "@engineerdad/store";
import { briefsLayout } from "./briefs";
import { scriptsLayout } from "./scripts";
import { authorityArticlesLayout } from "./authority-articles";
import { creativeVariantsLayout } from "./creative-variants";
import { experimentsLayout } from "./experiments";
import { performanceReportsLayout } from "./performance-reports";
import { hypothesesLayout } from "./hypotheses";
import { learningsLayout } from "./learnings";
import { distributionsLayout } from "./distributions";

const MAP: Record<EntityName, EntityLayout> = {
  Briefs: briefsLayout,
  Scripts: scriptsLayout,
  AuthorityArticles: authorityArticlesLayout,
  CreativeVariants: creativeVariantsLayout,
  Experiments: experimentsLayout,
  PerformanceReports: performanceReportsLayout,
  Hypotheses: hypothesesLayout,
  Learnings: learningsLayout,
  Distributions: distributionsLayout,
};

export function layoutFor(entity: EntityName): EntityLayout {
  return MAP[entity];
}
