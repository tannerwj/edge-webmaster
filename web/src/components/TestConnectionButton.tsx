import { useState } from "react";

export interface TestOutcome {
  ok: boolean;
  detail: string;
  items?: string[];
}

const MAX_ITEMS = 12;

function OutcomeItems({ items }: { items: string[] }) {
  const shown = items.slice(0, MAX_ITEMS);
  const extra = items.length - shown.length;
  return (
    <div className="small">
      <p className="muted">Can see:</p>
      <ul className="examples">
        {shown.map((item) => (
          <li key={item}>{item}</li>
        ))}
        {extra > 0 && <li className="muted">+{extra} more</li>}
      </ul>
    </div>
  );
}

export function TestConnectionButton({
  onTest,
  onOutcome,
  label = "Test connection",
}: {
  onTest: () => Promise<TestOutcome>;
  onOutcome?: (r: TestOutcome) => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [lastTestedAt, setLastTestedAt] = useState<Date | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    let result: TestOutcome;
    try {
      result = await onTest();
    } catch (err) {
      result = { ok: false, detail: err instanceof Error ? err.message : "Test failed." };
    }
    setOutcome(result);
    setLastTestedAt(new Date());
    onOutcome?.(result);
    setBusy(false);
  };

  return (
    <div>
      <button type="button" onClick={() => void run()} disabled={busy}>
        {busy ? "Testing…" : label}
      </button>
      <div aria-live="polite">
        {outcome && (
          <p className={outcome.ok ? "result result-ok" : "result result-bad"}>
            {outcome.ok ? "✓ " : "✗ "}
            {outcome.detail}
          </p>
        )}
        {outcome?.items && outcome.items.length > 0 && <OutcomeItems items={outcome.items} />}
        {lastTestedAt && (
          <p className="small muted">Last tested {lastTestedAt.toLocaleTimeString()}</p>
        )}
      </div>
    </div>
  );
}
