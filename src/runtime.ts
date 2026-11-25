import { PACKS } from "./packs";
import { liveTools, packStatuses, type Env, type ToolDef } from "./registry";

export async function liveToolsFor(env: Env): Promise<ToolDef[]> {
  const statuses = await packStatuses(env, PACKS);
  return liveTools(statuses);
}
