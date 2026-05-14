/**
 * @file components/widgets/FieldConfigWidget.tsx
 * @app web
 * @description Dynamic prop configuration form for a Pipedream component.
 *
 * Renders a form with one field per configurable prop on the given Pipedream
 * action or trigger component.  Three kinds of field rendering are supported:
 *
 *  1. Static options (<select>): props with an inline `options` array.
 *  2. Remote options (<RemoteOptionsField>): props with `remoteOptions: true`
 *     — options are fetched dynamically from Pipedream's configure-prop API
 *     using the user's connected account and any previously set prop values.
 *  3. Plain input (<input>): text, number, password for string/integer/boolean.
 *
 * Component resolution:
 *  The widget first tries to retrieve the component directly by key.  If that
 *  fails (LLM guessed a wrong key), it calls /v1/components/resolve to do
 *  fuzzy catalog matching.  The resolved key is shown to the user when it
 *  differs from the original.
 *
 * Auth guard:
 *  If the resolved app has no connected account (accountId absent), a
 *  ConnectAccountWidget is shown inline instead of the prop form.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REMOTE_OPTIONS_DEBOUNCE_MS } from "../../constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single configurable prop after filtering and normalisation.
 * remoteOptions: true means options must be fetched from the configure-prop API.
 */
type PropRow = {
  name: string;
  label?: string;
  type: string;
  optional?: boolean;
  secret?: boolean;
  options?: { label?: string; value: unknown }[];
  remoteOptions?: boolean;
};

/**
 * Shape of the JSON body returned by /v1/components/configure-prop.
 * options and stringOptions are the two ways Pipedream returns remote options.
 */
type ConfigurePropJson = {
  options?: { label?: string; value?: unknown }[];
  stringOptions?: string[];
  errors?: string[];
  error?: string;
};

// ---------------------------------------------------------------------------
// Prop filtering
// ---------------------------------------------------------------------------

/**
 * Filters and normalises a raw Pipedream configurableProps array into the
 * PropRow[] that the form will render.
 *
 * Inclusion rules:
 *  - type must be one of: string, string[], integer, boolean
 *    OR the prop must have remoteOptions: true (handles typed dropdowns like
 *    channel pickers which can have type "string[]" with remote options).
 *  - "app" type is always excluded — these are OAuth auth props, not user-editable.
 *  - Props with names starting "$" are Pipedream system props.
 *  - hidden / readOnly / disabled props are excluded.
 *
 * Why include remoteOptions regardless of base type?
 *  Slack's channel picker is type "string[]" with remoteOptions: true.
 *  Without this rule it would be filtered out, leaving the form empty even
 *  when the account is connected.
 *
 * @param raw  The raw configurableProps array from the Pipedream API.
 * @returns    Filtered and normalised PropRow[].
 */
function pickRenderableProps(raw: unknown[]): PropRow[] {
  const allow = new Set(["string", "string[]", "integer", "boolean"]);

  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({
      name: String(p.name ?? ""),
      label: typeof p.label === "string" ? p.label : undefined,
      type: String(p.type ?? ""),
      optional: Boolean(p.optional),
      secret: Boolean(p.secret),
      options: Array.isArray(p.options)
        ? (p.options as { label?: string; value: unknown }[])
        : undefined,
      remoteOptions: Boolean(p.remoteOptions),
    }))
    .filter(
      (p) =>
        p.name &&
        p.type !== "app" && // Always exclude OAuth props — not user-editable.
        (allow.has(p.type) || p.remoteOptions) && // Include remote-option props regardless of type.
        !p.name.startsWith("$") &&
        !(p as { hidden?: boolean }).hidden &&
        !(p as { readOnly?: boolean }).readOnly &&
        !(p as { disabled?: boolean }).disabled,
    );
}

/**
 * Builds the `configuredProps` object required by the configure-prop API.
 * Includes the app auth entry (authProvisionId) plus any already-set prop
 * values — these are needed so the API can fetch context-aware options
 * (e.g. sheets within a selected Google Drive).
 *
 * The app auth entry uses `{ authProvisionId: id }` rather than a bare string
 * because Pipedream's configure-prop endpoint requires the structured form to
 * load dependent remote options (e.g. `watchedDrive` requires drive auth).
 *
 * @param raw        Raw configurableProps to find the "app" type prop name.
 * @param accountId  The connected account's auth provision id (apn_...).
 * @returns          configuredProps object ready for the API call.
 */
function buildAppAuthConfiguredProps(
  raw: unknown[],
  accountId: string | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!accountId?.trim()) return out;

  const id = accountId.trim();

  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const rec = p as Record<string, unknown>;

    if (rec.type === "app" && typeof rec.name === "string" && rec.name) {
      out[rec.name] = { authProvisionId: id };
    }
  }

  return out;
}

/**
 * Builds the full configuredProps for a configure-prop call, combining the
 * app auth entry with any already-set upstream prop values.
 *
 * The prop being fetched (excludeProp) is intentionally excluded so it
 * doesn't create a circular dependency in the API call.
 *
 * @param props       All renderable props for this component.
 * @param values      Current form values keyed by prop name.
 * @param baseApp     App auth configuredProps (from buildAppAuthConfiguredProps).
 * @param excludeProp The prop currently being configured (excluded from context).
 * @returns           The full configuredProps object for the API call.
 */
function buildConfiguredPropsForConfigure(
  props: PropRow[],
  values: Record<string, string>,
  baseApp: Record<string, unknown>,
  excludeProp: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...baseApp };

  for (const p of props) {
    if (p.name === excludeProp) continue;
    const v = values[p.name]?.trim();
    if (!v) continue;

    // Coerce the value to the correct type for the API.
    out[p.name] =
      p.type === "integer" ? Number(v) : p.type === "boolean" ? v === "true" : v;
  }

  return out;
}

// ---------------------------------------------------------------------------
// RemoteOptionsField
// ---------------------------------------------------------------------------

/**
 * RemoteOptionsField
 *
 * Renders a search-filtered <select> backed by Pipedream's configure-prop API.
 * Options are re-fetched whenever the filter text, or any upstream prop value
 * changes (with REMOTE_OPTIONS_DEBOUNCE_MS debounce to avoid API flooding).
 *
 * Why debounce on all values?  Upstream props (e.g. "drive selection") affect
 * which options are available downstream (e.g. "sheet selection").  Reacting
 * to all value changes ensures the dropdown stays in sync.
 */
function RemoteOptionsField({
  pipedreamApiBase,
  externalUserId,
  componentKind,
  componentId,
  propName,
  props,
  values,
  baseAppConfigured,
  value,
  disabled,
  onChange,
}: {
  pipedreamApiBase: string;
  externalUserId: string;
  componentKind: "trigger" | "action";
  componentId: string;
  propName: string;
  props: PropRow[];
  values: Record<string, string>;
  baseAppConfigured: Record<string, unknown>;
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const [opts, setOpts] = useState<{ label: string; value: string }[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const reqId = useRef(0);

  // Stable ref to current context so runConfigure closure always uses the
  // latest values without needing to be in its dependency array.
  const ctxRef = useRef({ props, values, baseAppConfigured, propName });
  ctxRef.current = { props, values, baseAppConfigured, propName };

  /**
   * Fires a configure-prop call to fetch remote options for this prop.
   *
   * Uses reqId to discard stale responses when multiple calls are in-flight
   * (can happen when the user types quickly in the filter input).
   *
   * @param query  Optional search/filter string to pass to the API.
   */
  const runConfigure = useCallback(
    async (query: string) => {
      const id = ++reqId.current;
      setLoading(true);
      setHint(null);

      const { props: pr, values: va, baseAppConfigured: ba, propName: pn } = ctxRef.current;
      const configured = buildConfiguredPropsForConfigure(pr, va, ba, pn);

      console.log("[RemoteOptionsField] configure-prop", { propName: pn, componentId, query });

      try {
        const r = await fetch(`${pipedreamApiBase}/v1/components/configure-prop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: componentKind,
            externalUserId,
            id: componentId,
            propName: pn,
            configuredProps: configured,
            query: query.trim() || undefined,
            blocking: true,
          }),
        });

        const j = (await r.json()) as ConfigurePropJson & { error?: string };

        // Discard if a newer request has already been issued.
        if (id !== reqId.current) return;
        if (!r.ok) throw new Error((j as { error?: string }).error ?? r.statusText);

        // Normalise options to { label, value: string } — the API can return
        // either an `options` array (with label/value objects) or a
        // `stringOptions` array (with plain strings).
        const next: { label: string; value: string }[] = [];

        if (Array.isArray(j.options)) {
          for (const o of j.options) {
            const raw = o.value;
            const s = raw === undefined || raw === null ? "" : String(raw);
            next.push({ label: o.label ?? s, value: s });
          }
        }

        if (Array.isArray(j.stringOptions)) {
          for (const s of j.stringOptions) next.push({ label: s, value: s });
        }

        setOpts(next);
        console.log("[RemoteOptionsField] loaded", next.length, "options for", pn);

        if (j.errors?.length) setHint(j.errors.join("; "));
      } catch (e) {
        if (id !== reqId.current) return;
        console.error("[RemoteOptionsField] configure-prop error", e);
        setOpts([]);
        setHint(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [pipedreamApiBase, externalUserId, componentKind, componentId],
  );

  // Re-fetch options when the filter changes or any upstream value changes.
  useEffect(() => {
    const t = window.setTimeout(() => void runConfigure(filter), REMOTE_OPTIONS_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [filter, runConfigure, values, props, baseAppConfigured]);

  return (
    <div className="widget-field-remote">
      <input
        type="search"
        className="widget-field-remote-filter"
        placeholder="Search options…"
        value={filter}
        disabled={disabled}
        onChange={(e) => setFilter(e.target.value)}
        aria-label={`Filter ${propName}`}
      />
      {loading ? <span className="muted small">Loading options…</span> : null}
      {hint ? <span className="muted small widget-field-remote-hint">{hint}</span> : null}
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {opts.map((o) => (
          <option key={`${o.value}:${o.label}`} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldConfigWidget
// ---------------------------------------------------------------------------

/**
 * FieldConfigWidget
 *
 * Loads the configurable props for a Pipedream component and renders a dynamic
 * form.  Resolution is attempted in two stages:
 *  1. Direct GET /v1/triggers/:key or /v1/actions/:key.
 *  2. If not found, GET /v1/components/resolve for fuzzy catalog matching.
 *
 * On submit, calls onDone with a text description of all field values
 * (e.g. "Configured slack-send-message: channel=C0B3F2UCNBD, text=Hello")
 * so the assistant can parse and store them in the workflow patch.
 *
 * @prop pipedreamApiBase  Base URL of the pipedream-api service.
 * @prop externalUserId    Pipedream external user id for configure-prop calls.
 * @prop componentKey      The component key to load (may be a hint, will be resolved).
 * @prop componentType     Hint for which endpoint to try first (trigger | action).
 * @prop appSlug           App slug hint for catalog resolve fallback.
 * @prop accountId         Connected account id for remote-options auth context.
 * @prop disabled          When true, all form controls are disabled.
 * @prop onDone            Callback with the configuration summary text.
 */
export function FieldConfigWidget({
  pipedreamApiBase,
  externalUserId,
  componentKey,
  componentType,
  appSlug,
  accountId,
  disabled,
  onDone,
}: {
  pipedreamApiBase: string;
  externalUserId: string;
  componentKey: string;
  componentType?: "action" | "trigger";
  appSlug?: string;
  accountId?: string;
  disabled?: boolean;
  onDone: (detail: string) => void;
}) {
  const [props, setProps] = useState<PropRow[]>([]);
  const [rawProps, setRawProps] = useState<unknown[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [resolvedKey, setResolvedKey] = useState(componentKey);
  const [resolvedKind, setResolvedKind] = useState<"trigger" | "action">(
    componentType === "action" ? "action" : "trigger",
  );

  // Derive the app slug for catalog resolve: prefer explicit prop, fall back
  // to inferring from the component key's prefix (e.g. "slack-..." → "slack").
  const appForResolve = useMemo(() => {
    const s = appSlug?.trim();
    if (s) return s;
    const dash = componentKey.indexOf("-");
    if (dash > 0) return componentKey.slice(0, dash);
    return "";
  }, [appSlug, componentKey]);

  // Build the auth context object once when rawProps or accountId change.
  const baseAppConfigured = useMemo(
    () => buildAppAuthConfiguredProps(rawProps, accountId),
    [rawProps, accountId],
  );

  /**
   * Loads the component definition and builds the form.
   *
   * Resolution strategy:
   *  1. Try componentType-preferred endpoint directly.
   *  2. If that 404s, try the other kind.
   *  3. If both fail, call /v1/components/resolve for fuzzy matching.
   *  4. If all fail, show error.
   */
  const load = useCallback(async () => {
    console.log("[FieldConfigWidget] Loading component:", componentKey);
    setLoading(true);
    setErr(null);

    try {
      const tryPath = (kind: "trigger" | "action") =>
        kind === "trigger"
          ? `/v1/triggers/${encodeURIComponent(componentKey)}`
          : `/v1/actions/${encodeURIComponent(componentKey)}`;

      // Determine the order of kinds to try based on the componentType hint.
      const kindsTry: ("trigger" | "action")[] =
        componentType === "action"
          ? ["action", "trigger"]
          : componentType === "trigger"
            ? ["trigger", "action"]
            : ["trigger", "action"];

      let data: { configurableProps?: unknown[] } | undefined;
      let matched = componentKey;
      let kind: "trigger" | "action" = componentType === "action" ? "action" : "trigger";

      // Stage 1: direct retrieve.
      for (const k of kindsTry) {
        console.log(`[FieldConfigWidget] Trying direct retrieve as ${k}:`, componentKey);
        const r = await fetch(`${pipedreamApiBase}${tryPath(k)}`);
        const j = (await r.json()) as {
          data?: { configurableProps?: unknown[] };
          error?: string;
        };

        if (r.ok && j.data && Array.isArray(j.data.configurableProps)) {
          data = j.data;
          matched = componentKey;
          kind = k;
          console.log("[FieldConfigWidget] Direct retrieve hit:", componentKey, kind);
          break;
        }
      }

      // Stage 2: fuzzy resolve via catalog if direct retrieve failed.
      if (!data?.configurableProps) {
        console.log("[FieldConfigWidget] Direct retrieve missed — trying resolve:", componentKey);
        const qs = new URLSearchParams({ key: componentKey, kind: "auto" });
        if (appForResolve) qs.set("app", appForResolve);

        const r2 = await fetch(`${pipedreamApiBase}/v1/components/resolve?${qs.toString()}`);
        const j2 = (await r2.json()) as {
          matchedKey?: string;
          kind?: string;
          data?: { configurableProps?: unknown[] };
          error?: string;
        };

        if (!r2.ok || !j2.data || !Array.isArray(j2.data.configurableProps)) {
          throw new Error(
            j2.error ??
              (!r2.ok
                ? `Resolve HTTP ${r2.status}`
                : "Resolve returned no configurableProps"),
          );
        }

        data = j2.data;
        matched = typeof j2.matchedKey === "string" ? j2.matchedKey : componentKey;
        kind = j2.kind === "action" ? "action" : "trigger";
        console.log("[FieldConfigWidget] Resolved:", componentKey, "→", matched, kind);
      }

      // Filter and set the renderable props.
      const list = pickRenderableProps(data.configurableProps ?? []);
      console.log("[FieldConfigWidget] Renderable props:", list.map((p) => p.name));

      setProps(list);
      setRawProps(data.configurableProps ?? []);
      setResolvedKey(matched);
      setResolvedKind(kind);

      // Initialise all form values to empty string.
      const init: Record<string, string> = {};
      for (const p of list) init[p.name] = "";
      setValues(init);
    } catch (e) {
      console.error("[FieldConfigWidget] Failed to load component:", componentKey, e);
      setErr(e instanceof Error ? e.message : String(e));
      setProps([]);
      setRawProps([]);
    } finally {
      setLoading(false);
    }
  }, [pipedreamApiBase, componentKey, componentType, appForResolve]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Validates that all required fields have values and fires onDone with a
   * summary string listing all field=value pairs.
   */
  function submit() {
    const parts: string[] = [];

    for (const p of props) {
      const v = values[p.name]?.trim();
      if (!v && !p.optional) {
        setErr(`Missing value for ${p.label ?? p.name}`);
        return;
      }
      if (v) parts.push(`${p.name}=${v}`);
    }

    setErr(null);
    const summary = `Configured ${resolvedKey}: ${parts.join(", ")}`;
    console.log("[FieldConfigWidget] Submitting configuration:", summary);
    onDone(summary);
  }

  return (
    <div className="widget-card">
      {/* Show a note when the resolved key differs from the original hint. */}
      {!loading && resolvedKey !== componentKey ? (
        <p className="muted small">
          Resolved component key <code>{resolvedKey}</code> (catalog match for{" "}
          <code>{componentKey}</code>).
        </p>
      ) : null}

      {loading ? <p className="muted small">Loading fields…</p> : null}
      {err ? <p className="widget-err">{err}</p> : null}

      {/* Render a form field for each renderable prop. */}
      {!loading &&
        props.map((p) => (
          <label key={p.name} className="widget-field">
            {p.label ?? p.name}
            {p.optional ? <span className="muted"> (optional)</span> : null}

            {p.remoteOptions ? (
              // Remote dropdown — options fetched from configure-prop API.
              <RemoteOptionsField
                pipedreamApiBase={pipedreamApiBase}
                externalUserId={externalUserId}
                componentKind={resolvedKind}
                componentId={resolvedKey}
                propName={p.name}
                props={props}
                values={values}
                baseAppConfigured={baseAppConfigured}
                value={values[p.name] ?? ""}
                disabled={disabled}
                onChange={(next) => setValues((v) => ({ ...v, [p.name]: next }))}
              />
            ) : p.options && p.options.length > 0 ? (
              // Static dropdown — inline options from the component definition.
              <select
                value={values[p.name] ?? ""}
                disabled={disabled}
                onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
              >
                <option value="">—</option>
                {p.options.map((o, i) => (
                  <option key={i} value={String(o.value ?? "")}>
                    {o.label ?? String(o.value ?? "")}
                  </option>
                ))}
              </select>
            ) : (
              // Plain text/number/password input.
              <input
                type={p.secret ? "password" : p.type === "integer" ? "number" : "text"}
                value={values[p.name] ?? ""}
                disabled={disabled}
                onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
              />
            )}
          </label>
        ))}

      {/* Submit button — only shown when there are props to configure. */}
      {!loading && props.length > 0 ? (
        <button type="button" className="btn-send" disabled={disabled} onClick={submit}>
          Submit configuration
        </button>
      ) : null}

      {/* Fallback message when no renderable props were found. */}
      {!loading && props.length === 0 && !err ? (
        <p className="muted small">
          No configurable fields found for <code>{resolvedKey}</code>. This may mean the component
          key points to a trigger instead of an action, or all fields require auth that isn&apos;t
          connected yet. Try telling the assistant what values you want (e.g. "send to #general
          channel") and it will store them on the draft.
        </p>
      ) : null}
    </div>
  );
}
