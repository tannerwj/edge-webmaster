import type { ReactNode } from "react";
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
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={s.title} className="step">
          <span className="step-num" aria-hidden="true">{i + 1}</span>
          <div className="step-body">
            <p className="step-title">{s.title}</p>
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
          </div>
        </li>
      ))}
    </ol>
  );
}
