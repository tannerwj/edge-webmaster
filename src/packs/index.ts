import type { ConnectorPack } from "../registry";
import { bingPack } from "./bing";
import { ga4Pack } from "./ga4";
import { gscPack } from "./gsc";
import { pagespeedPack } from "./pagespeed";

import { indexNowPack } from "./indexnow";

export const PACKS: ConnectorPack[] = [gscPack, ga4Pack, bingPack, pagespeedPack, indexNowPack];
