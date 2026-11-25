import { grantTools, type Grants } from "./grants";
import { PACKS } from "./packs";
import { liveTools, packStatuses, type Env, type ToolDef } from "./registry";

export async function liveToolsFor(env: Env, grants?: Grants | null): Promise<ToolDef[]> {
  const statuses = await packStatuses(env, PACKS);
  return grantTools(liveTools(statuses), grants);
}
