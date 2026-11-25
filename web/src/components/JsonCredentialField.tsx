import { useRef, useState } from "react";
import type { DragEvent } from "react";

export interface JsonValidation {
  ok: boolean;
  message: string;
}

function missingFields(record: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (record.type !== "service_account") missing.push('a type of "service_account"');
  if (typeof record.client_email !== "string" || !record.client_email.includes("@")) {
    missing.push("a client_email containing @");
  }
  if (typeof record.private_key !== "string" || !record.private_key) {
    missing.push("a private_key");
  }
  return missing;
}

export function validateServiceAccountJson(text: string): JsonValidation {
  if (!text.trim()) return { ok: false, message: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message: "That doesn't parse as JSON — paste or choose the full .json key file.",
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: "That JSON is missing a type of \"service_account\", a client_email containing @, and a private_key." };
  }
  const record = parsed as Record<string, unknown>;
  const missing = missingFields(record);
  if (missing.length > 0) {
    return { ok: false, message: `That JSON is missing ${missing.join(", ")}.` };
  }
  return { ok: true, message: `Looks good — service account ${String(record.client_email)}` };
}

export function JsonCredentialField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [readError, setReadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const validation = validateServiceAccountJson(value);

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    setReadError("");
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setFileName(file.name);
        onChange(reader.result);
      } else {
        setReadError("Couldn't read that file — try pasting the key instead.");
      }
    };
    reader.onerror = () => setReadError("Couldn't read that file — try pasting the key instead.");
    reader.readAsText(file);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    loadFile(e.dataTransfer.files?.[0]);
  };

  return (
    <div
      className={dragging ? "drop-active" : undefined}
      data-dragging={dragging || undefined}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <div className="row">
        <button type="button" className="ghost btn-small" onClick={() => inputRef.current?.click()}>
          Choose file…
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => loadFile(e.target.files?.[0])}
        />
        {fileName && <span className="small muted">Loaded {fileName}</span>}
      </div>
      {readError && <p className="result result-bad small">{readError}</p>}
      <div aria-live="polite">
        {validation.message && (
          <p className={validation.ok ? "result result-ok small" : "result result-bad small"}>
            {validation.message}
          </p>
        )}
      </div>
    </div>
  );
}
