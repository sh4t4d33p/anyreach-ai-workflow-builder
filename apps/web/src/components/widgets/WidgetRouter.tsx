/**
 * @file components/widgets/WidgetRouter.tsx
 * @app web
 * @description Routes an assistant WidgetEnvelope to the correct interactive
 * widget component.
 *
 * The LLM decides which widget to show each turn by returning a widgetKind and
 * widgetPayload.  WidgetRouter decodes the payload and renders the matching
 * component, handling graceful fallbacks when required fields are missing.
 *
 * Widget kinds handled:
 *  - app_picker        → AppPickerWidget     (browse/search Pipedream apps)
 *  - connect_account   → ConnectAccountWidget (OAuth popup via Pipedream Connect)
 *  - field_config      → FieldConfigWidget    (dynamic prop form for a component)
 *  - workflow_summary  → WorkflowSummaryWidget (review + edit policies before finalize)
 *  - conditional_builder → ConditionalBuilderWidget (branch condition form)
 *  - unknown kind      → raw JSON pre block (developer fallback)
 *
 * For field_config, payload resolution is non-trivial: the LLM may omit or
 * misspell the componentKey.  resolveFieldConfig() applies a multi-level
 * fallback strategy to find the best available key from the payload and draft.
 */

import type { PipedreamClient } from "@pipedream/sdk/browser";
import type { WidgetEnvelope } from "../../types/assistantTurn";
import type { WorkflowDraft } from "../../types/session";
import { AppPickerWidget } from "./AppPickerWidget";
import { ConditionalBuilderWidget } from "./ConditionalBuilderWidget";
import { ConnectAccountWidget } from "./ConnectAccountWidget";
import { FieldConfigWidget } from "./FieldConfigWidget";
import { WorkflowSummaryWidget } from "./WorkflowSummaryWidget";

// ---------------------------------------------------------------------------
// Payload extraction helpers
// ---------------------------------------------------------------------------

/**
 * Reads the first non-empty string value for any of the given keys from a
 * plain object.  Used to normalise aliased field names in widget payloads
 * (e.g. "app" vs "appSlug" vs "nameSlug").
 *
 * @param p     Source object.
 * @param keys  Keys to try in order.
 * @returns     First non-empty string value found, or "".
 */
function readString(p: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Reads the app slug from the widget payload, falling back to the draft
 * trigger's app field.
 *
 * The LLM may include the slug under different key names ("app", "appSlug",
 * "nameSlug") and may sometimes omit it entirely.  Falling back to the draft
 * trigger ensures the FieldConfigWidget can still resolve the component via
 * catalog search even when the payload is incomplete.
 *
 * @param draft    Current workflow draft (for trigger fallback).
 * @param payload  Widget payload from the assistant.
 * @returns        App slug string, or "" if not determinable.
 */
function readAppSlug(draft: WorkflowDraft, payload: Record<string, unknown>): string {
  const fromPayload = readString(payload, "app", "appSlug", "nameSlug");
  if (fromPayload) return fromPayload;

  const trig = draft.trigger;
  if (trig && typeof trig === "object" && !Array.isArray(trig)) {
    return readString(trig as Record<string, unknown>, "app", "appSlug", "nameSlug");
  }

  return "";
}

/**
 * Reads the Pipedream account id (authProvisionId) from the widget payload,
 * falling back to the draft trigger's accountId.
 *
 * The accountId is needed by FieldConfigWidget to pass authentication context
 * to the Pipedream configure-prop API for remote dropdown options.
 *
 * @param draft    Current workflow draft (for trigger auth fallback).
 * @param payload  Widget payload from the assistant.
 * @returns        Account id string, or "" if not connected yet.
 */
function readAccountId(draft: WorkflowDraft, payload: Record<string, unknown>): string {
  const fromPayload = readString(payload, "accountId", "account_id", "pdAccountId", "authProvisionId");
  if (fromPayload) return fromPayload;

  const trig = draft.trigger;
  if (trig && typeof trig === "object" && !Array.isArray(trig)) {
    return readString(trig as Record<string, unknown>, "accountId", "account_id", "pdAccountId", "authProvisionId");
  }

  return "";
}

/**
 * Infers the app slug from a component key by taking the first dash-separated
 * segment.
 *
 * Example: "slack-send-message" → "slack"
 *          "google_sheets-new-spreadsheet-row" → "google_sheets"
 *
 * Used as a last-resort fallback when neither the payload nor the draft
 * provides an explicit app slug.
 *
 * @param componentKey  A Pipedream component key string.
 * @returns             The prefix up to the first dash, or "" for keyless.
 */
function inferAppSlugFromComponentKey(componentKey: string): string {
  const k = componentKey.trim();
  const i = k.indexOf("-");
  if (i <= 0) return "";
  return k.slice(0, i);
}

// ---------------------------------------------------------------------------
// field_config resolution
// ---------------------------------------------------------------------------

/** Resolved parameters needed to render FieldConfigWidget. */
type FieldConfigResolved = {
  componentKey: string;
  componentType: "action" | "trigger";
  appSlug: string;
  accountId: string;
};

/**
 * Resolves all parameters needed to render FieldConfigWidget from the widget
 * payload and the current workflow draft.
 *
 * Resolution priority for componentKey:
 *  1. Explicit key in payload (componentKey, component_key, key, etc.).
 *  2. Lookup by stepId → draft.steps[].componentKey.
 *  3. Draft trigger's componentKey (when payload signals trigger intent).
 *  4. Draft trigger's componentKey (unconditional fallback).
 *  5. Last draft step's componentKey (action fallback).
 *  6. null (cannot resolve — show error message).
 *
 * @param draft    Current workflow draft.
 * @param payload  Widget payload from the assistant turn.
 * @returns        FieldConfigResolved or null if no key can be determined.
 */
function resolveFieldConfig(
  draft: WorkflowDraft,
  payload: Record<string, unknown>,
): FieldConfigResolved | null {
  const key = readString(
    payload,
    "componentKey",
    "component_key",
    "key",
    "pipedreamKey",
    "pipedream_key",
  );
  const stepId = readString(payload, "stepId", "step_id");

  const wantsTrigger =
    payload.componentType === "trigger" ||
    payload.component_type === "trigger" ||
    payload.target === "trigger";

  const wantsAction =
    payload.componentType === "action" ||
    payload.component_type === "action" ||
    payload.target === "action" ||
    payload.target === "step";

  const appSlug = readAppSlug(draft, payload);
  const accountId = readAccountId(draft, payload);

  // Priority 1: explicit key in payload.
  if (key) {
    const t: "action" | "trigger" = wantsTrigger && !wantsAction ? "trigger" : "action";
    return { componentKey: key, componentType: t, appSlug, accountId };
  }

  // Priority 2: look up by stepId in the draft steps array.
  if (stepId && draft.steps?.length) {
    const step = draft.steps.find((s) => String((s as { id?: unknown }).id) === stepId);
    const ck =
      step && typeof (step as { componentKey?: unknown }).componentKey === "string"
        ? String((step as { componentKey: string }).componentKey)
        : "";
    if (ck) {
      let slug = appSlug;
      let acct = accountId;
      if (step && typeof step === "object" && !Array.isArray(step)) {
        const rec = step as Record<string, unknown>;
        const sa = readString(rec, "app", "appSlug", "nameSlug");
        if (sa) slug = sa;
        const aid = readString(rec, "accountId", "account_id", "pdAccountId", "authProvisionId");
        if (aid) acct = aid;
      }
      return { componentKey: ck, componentType: "action", appSlug: slug, accountId: acct };
    }
  }

  // Priority 3 & 4: use the draft trigger key.
  const trig = draft.trigger;
  const trigKey =
    trig && typeof (trig as { componentKey?: unknown }).componentKey === "string"
      ? String((trig as { componentKey: string }).componentKey)
      : "";

  if (trigKey && (wantsTrigger || !wantsAction)) {
    return { componentKey: trigKey, componentType: "trigger", appSlug, accountId };
  }
  if (trigKey) {
    return { componentKey: trigKey, componentType: "trigger", appSlug, accountId };
  }

  // Priority 5: fall back to the last draft step.
  const last = draft.steps?.[draft.steps.length - 1];
  const lastKey =
    last && typeof (last as { componentKey?: unknown }).componentKey === "string"
      ? String((last as { componentKey: string }).componentKey)
      : "";

  if (lastKey) {
    let slug = appSlug;
    let acct = accountId;
    if (last && typeof last === "object" && !Array.isArray(last)) {
      const rec = last as Record<string, unknown>;
      const sa = readString(rec, "app", "appSlug", "nameSlug");
      if (sa) slug = sa;
      const aid = readString(rec, "accountId", "account_id", "pdAccountId", "authProvisionId");
      if (aid) acct = aid;
    }
    return { componentKey: lastKey, componentType: "action", appSlug: slug, accountId: acct };
  }

  // Priority 6: unresolvable.
  return null;
}

// ---------------------------------------------------------------------------
// Router component
// ---------------------------------------------------------------------------

/** Props accepted by WidgetRouter. */
type RouterProps = {
  widget: WidgetEnvelope;
  pipedreamApiBase: string;
  pdBrowser: PipedreamClient;
  externalUserId: string;
  workflowDraft: WorkflowDraft;
  disabled?: boolean;
  onUserCommit: (messageText: string) => Promise<void>;
  onPoliciesApply: (next: WorkflowDraft, messageText: string) => Promise<void>;
};

/**
 * WidgetRouter
 *
 * Decodes the assistant WidgetEnvelope and renders the matching interactive
 * widget component.  Each branch handles payload validation and renders a
 * friendly error message when required fields are missing rather than crashing.
 */
export function WidgetRouter({
  widget,
  pipedreamApiBase,
  pdBrowser,
  externalUserId,
  workflowDraft,
  disabled,
  onUserCommit,
  onPoliciesApply,
}: RouterProps) {
  const payload = widget.payload;

  switch (widget.kind) {
    case "app_picker":
      return (
        <AppPickerWidget
          pipedreamApiBase={pipedreamApiBase}
          initialQuery={typeof payload.query === "string" ? payload.query : undefined}
          disabled={disabled}
          onPick={(slug, name) => void onUserCommit(`I pick app ${name} (${slug}).`)}
        />
      );

    case "connect_account": {
      const app = typeof payload.app === "string" ? payload.app : "";
      if (!app) {
        return <p className="widget-err">connect_account widget missing payload.app</p>;
      }
      return (
        <ConnectAccountWidget
          pdBrowser={pdBrowser}
          app={app}
          disabled={disabled}
          onDone={(line) => void onUserCommit(line)}
        />
      );
    }

    case "field_config": {
      const resolved = resolveFieldConfig(workflowDraft, payload);

      if (!resolved) {
        return (
          <p className="widget-err">
            Could not resolve a Pipedream <code>componentKey</code>. Ask the assistant again, or
            ensure the draft trigger/steps include <code>componentKey</code>.
          </p>
        );
      }

      // Prefer explicit slug from resolution; fall back to inferring from the component key.
      const slug = resolved.appSlug.trim() || inferAppSlugFromComponentKey(resolved.componentKey);
      const hasAccount = Boolean(resolved.accountId.trim());

      // If the app has no connected account yet, show ConnectAccountWidget inline
      // rather than FieldConfigWidget — remote options won't work without auth.
      if (!hasAccount && slug) {
        return (
          <div className="widget-card">
            <p className="muted small">
              This form loads options through Pipedream Connect. Connect{" "}
              <strong>{slug}</strong> first, then the assistant will store{" "}
              <code>accountId</code> on the draft so fields work.
            </p>
            <ConnectAccountWidget
              pdBrowser={pdBrowser}
              app={slug}
              disabled={disabled}
              onDone={(line) => void onUserCommit(line)}
            />
          </div>
        );
      }

      return (
        <FieldConfigWidget
          pipedreamApiBase={pipedreamApiBase}
          externalUserId={externalUserId}
          componentKey={resolved.componentKey}
          componentType={resolved.componentType}
          appSlug={
            resolved.appSlug.trim() ||
            inferAppSlugFromComponentKey(resolved.componentKey) ||
            undefined
          }
          accountId={resolved.accountId || undefined}
          disabled={disabled}
          onDone={(line) => void onUserCommit(line)}
        />
      );
    }

    case "workflow_summary":
      return (
        <WorkflowSummaryWidget
          draft={workflowDraft}
          disabled={disabled}
          onPoliciesApply={(next, line) => void onPoliciesApply(next, line)}
          onContinue={(line) => void onUserCommit(line)}
        />
      );

    case "conditional_builder":
      return (
        <ConditionalBuilderWidget
          disabled={disabled}
          onDone={(line) => void onUserCommit(line)}
        />
      );

    default:
      // Unknown widget kind — render raw JSON for developer debugging.
      return <pre className="widget-preview-json">{JSON.stringify(widget, null, 2)}</pre>;
  }
}
