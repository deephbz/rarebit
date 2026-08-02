import type {
  RarebitSummaryReceiptV4,
  RarebitTitleReceiptV4,
  readRarebitHistory,
} from "../src/types.d.ts";

type History = Awaited<ReturnType<typeof readRarebitHistory>>;
type Receipt = History["records"][number]["record"];

const assertExactUnion = (
  value: Receipt,
): RarebitSummaryReceiptV4 | RarebitTitleReceiptV4 => value;
void assertExactUnion;
