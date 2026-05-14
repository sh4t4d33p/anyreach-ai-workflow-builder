/**
 * @file components/widgets/AppPickerWidget.tsx
 * @app web
 * @description Debounced app search widget backed by the pipedream-api /v1/apps endpoint.
 *
 * Allows the user to browse and select a Pipedream integration app.  As the
 * user types, the query is debounced (APP_PICKER_DEBOUNCE_MS) before firing
 * a search request so we don't flood the API on every keystroke.
 *
 * On app selection, onPick is called with the app slug and display name.
 * The parent (WidgetRouter) converts this to a user chat message.
 */

import { useCallback, useEffect, useState } from "react";
import { APP_PICKER_FETCH_LIMIT, APP_PICKER_DEBOUNCE_MS } from "../../constants";

/** Shape of a single app record returned by /v1/apps. */
type AppRow = { id: string; nameSlug: string; name: string; imgSrc?: string };

/**
 * AppPickerWidget
 *
 * Renders a search input and a grid of app tiles.  Results are fetched from
 * the pipedream-api /v1/apps endpoint with debouncing to limit API calls.
 *
 * @prop pipedreamApiBase  Base URL of the pipedream-api service.
 * @prop initialQuery      Optional pre-filled search term (from widget payload).
 * @prop disabled          When true, disables the input and tiles.
 * @prop onPick            Callback fired with (slug, name) when a tile is clicked.
 */
export function AppPickerWidget({
  pipedreamApiBase,
  initialQuery,
  disabled,
  onPick,
}: {
  pipedreamApiBase: string;
  initialQuery?: string;
  disabled?: boolean;
  onPick: (slug: string, name: string) => void;
}) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [loading, setLoading] = useState(false);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  /**
   * Fetches apps matching the current query from the pipedream-api.
   * Resets error state on each call; updates apps list or sets error on failure.
   */
  const search = useCallback(async () => {
    console.log("[AppPickerWidget] search — q:", q);
    setLoading(true);
    setErr(null);

    try {
      const params = new URLSearchParams({ limit: String(APP_PICKER_FETCH_LIMIT) });
      if (q.trim()) params.set("q", q.trim());

      const r = await fetch(`${pipedreamApiBase}/v1/apps?${params}`);
      const j = (await r.json()) as { data?: AppRow[]; error?: string };

      if (!r.ok) throw new Error(j.error ?? r.statusText);

      console.log("[AppPickerWidget] search — returned", j.data?.length ?? 0, "results");
      setApps(j.data ?? []);
    } catch (e) {
      console.error("[AppPickerWidget] search error", e);
      setErr(e instanceof Error ? e.message : String(e));
      setApps([]);
    } finally {
      setLoading(false);
    }
  }, [pipedreamApiBase, q]);

  // Debounce: fire search after APP_PICKER_DEBOUNCE_MS of inactivity.
  // The cleanup function cancels the timeout if the query changes before it fires.
  useEffect(() => {
    const t = window.setTimeout(() => {
      void search();
    }, APP_PICKER_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search]);

  return (
    <div className="widget-card">
      <label className="widget-field">
        Search apps
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="slack, sheets, github…"
          disabled={disabled}
        />
      </label>

      {err ? <p className="widget-err">{err}</p> : null}

      <div className="widget-app-grid">
        {loading ? <span className="muted small">Loading…</span> : null}
        {!loading &&
          apps.map((a) => (
            <button
              key={a.id}
              type="button"
              className="widget-app-tile"
              disabled={disabled}
              onClick={() => {
                console.log("[AppPickerWidget] picked app:", a.nameSlug);
                onPick(a.nameSlug, a.name);
              }}
            >
              {a.imgSrc ? (
                <img src={a.imgSrc} alt="" className="widget-app-icon" loading="lazy" />
              ) : (
                <span className="widget-app-fallback">{a.name.slice(0, 1)}</span>
              )}
              <span className="widget-app-name">{a.name}</span>
            </button>
          ))}
      </div>
    </div>
  );
}
