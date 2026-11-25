import type { Connector } from "../api";

export type Selections = Record<string, string>;

export function TokenGrants({ connectors, selected, change }: {
  connectors: Connector[]; selected: Selections | null; change: (next: Selections | null) => void;
}) {
  return <fieldset className="grants">
    <legend>Connector access</legend>
    <select aria-label="Connector access" value={selected ? "custom" : "all"}
      onChange={(e) => change(e.target.value === "all" ? null : {})}>
      <option value="all">All connectors and properties</option>
      <option value="custom">Choose connectors and properties</option>
    </select>
    {selected && connectors.map((c) => {
      const ns = c.namespace;
      const enabled = Object.hasOwn(selected, ns);
      return <div key={ns}>
        <label><input type="checkbox" checked={enabled} onChange={() => {
          const next = { ...selected };
          if (enabled) delete next[ns];
          else next[ns] = "";
          change(next);
        }} /> {c.name}</label>
        {enabled && ns !== "pagespeed" && <label>
          {ns === "ga4" ? "GA4 numeric property IDs" : "Exact properties from this connector"} (one per line, blank for all)
          <textarea value={selected[ns]} placeholder={ns === "ga4" ? "123456789" : ns === "gsc" ? "sc-domain:example.com" : "https://example.com/"}
            onChange={(e) => change({ ...selected, [ns]: e.target.value })} />
        </label>}
      </div>;
    })}
  </fieldset>;
}
