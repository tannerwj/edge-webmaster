import { useState, type ReactNode } from "react";
import { CopyButton } from "./CopyButton";

export interface Step {
  title: string;
  instruction: string;
  links?: { label: string; href: string }[];
  copyValue?: string;
  copyLabel?: string;
  content?: ReactNode;
}

export function StepList({ steps }: { steps: Step[] }) {
  const [active, setActive] = useState(0);
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={s.title} className="step">
          <span className="step-num" aria-hidden="true">{i + 1}</span>
          <div className="step-body">
            <button type="button" aria-expanded={active === i} className="step-heading" onClick={() => setActive(i)}>{s.title}</button>
            <div hidden={active !== i}>
            <p className="step-text">{s.instruction}</p>
            {(s.links?.length || s.copyValue) && (
              <div className="row step-actions">
                {s.links?.map((l) => (
                  <a key={l.href + l.label} className="btn-link" href={l.href} target="_blank" rel="noreferrer">
                    {l.label} ↗
                  </a>
                ))}
                {s.copyValue && <CopyButton value={s.copyValue} label={s.copyLabel ?? "Copy"} />}
              </div>
            )}
            {s.copyValue && (
              <p className="step-copy-value"><code>{s.copyValue}</code></p>
            )}
            {s.content}
            {i + 1 < steps.length && <button type="button" className="ghost btn-small" onClick={() => setActive(i + 1)}>Next step →</button>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
