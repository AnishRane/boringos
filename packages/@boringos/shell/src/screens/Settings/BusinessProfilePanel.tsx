// SPDX-License-Identifier: BUSL-1.1
//
// Settings → Business Profile panel.
//
// Tenant-wide structured business context (industry, what we do,
// ICP, signal/noise examples, competitors, tone). Edited via
// `framework.tenant.update_business_profile`; read by every
// module that wants to ground LLM calls or classifiers in the
// tenant's business — today the CRM uses it for ICP-gated lead
// creation.

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "../../auth/AuthProvider.js";
import { Button } from "../../components/ui/button.js";

interface BusinessProfile {
  industry: string | null;
  whatWeDo: string | null;
  idealCustomer: string | null;
  signalExamples: string[];
  noiseExamples: string[];
  competitors: string[];
  tone: string | null;
}

const EMPTY: BusinessProfile = {
  industry: null,
  whatWeDo: null,
  idealCustomer: null,
  signalExamples: [],
  noiseExamples: [],
  competitors: [],
  tone: null,
};

function authHeaders(token: string | null, tenantId: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

async function callTool<T>(
  name: string,
  input: unknown,
  token: string | null,
  tenantId: string | null,
): Promise<T> {
  const res = await fetch(`/api/tools/${name}`, {
    method: "POST",
    headers: authHeaders(token, tenantId),
    body: JSON.stringify(input ?? {}),
  });
  const body = (await res.json()) as
    | { ok: true; result: T }
    | { ok: false; error: { message: string } };
  if (!body.ok) throw new Error(body.error.message);
  return body.result;
}

export function BusinessProfilePanel() {
  const { user, token } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const isAdmin = user?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<BusinessProfile>(EMPTY);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await callTool<{ profile: BusinessProfile }>(
          "framework.tenant.get_business_profile",
          {},
          token,
          tenantId,
        );
        if (!cancelled) setDraft(result.profile);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load business profile");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, tenantId]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const result = await callTool<{ profile: BusinessProfile }>(
        "framework.tenant.update_business_profile",
        draft,
        token,
        tenantId,
      );
      setDraft(result.profile);
      setSavedAt(Date.now());
      toast.success("Business profile saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-xl">
        <p className="text-sm text-muted">
          Business profile is admin-only. Ask a tenant admin to fill this in.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-muted">Loading…</div>;
  }

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-muted mb-6">
        Tells the agents what your company does. Modules use this to decide
        which emails matter (CRM uses it to gate lead creation), what tone to
        write in, and how to ground LLM reasoning in your context. Save once
        and every agent inherits it.
      </p>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-5">
        <TextField
          label="Industry"
          placeholder="B2B AI infrastructure"
          value={draft.industry ?? ""}
          onChange={(v) => setDraft({ ...draft, industry: v || null })}
        />
        <TextArea
          label="What we do"
          placeholder="One-paragraph pitch of the product / business — what you sell, who buys, what changes for them."
          value={draft.whatWeDo ?? ""}
          onChange={(v) => setDraft({ ...draft, whatWeDo: v || null })}
          rows={4}
        />
        <TextArea
          label="Ideal customer (ICP)"
          placeholder="e.g. Series A–C engineering teams shipping LLM products to enterprise customers."
          value={draft.idealCustomer ?? ""}
          onChange={(v) => setDraft({ ...draft, idealCustomer: v || null })}
          rows={3}
        />
        <ListField
          label="Signal examples (emails that always matter)"
          help="Free-form one-liners. Eg. 'founder reaching out about integration', 'enterprise pilot inquiry', 'press inquiry'."
          values={draft.signalExamples}
          onChange={(arr) => setDraft({ ...draft, signalExamples: arr })}
        />
        <ListField
          label="Noise examples (emails to ignore)"
          help="Eg. 'newsletter', 'vendor cold pitch', 'recruiter outreach'."
          values={draft.noiseExamples}
          onChange={(arr) => setDraft({ ...draft, noiseExamples: arr })}
        />
        <ListField
          label="Competitors"
          help="One per line. Used so agents recognize competitive signals."
          values={draft.competitors}
          onChange={(arr) => setDraft({ ...draft, competitors: arr })}
        />
        <TextField
          label="Tone"
          placeholder="direct, technical, no fluff"
          value={draft.tone ?? ""}
          onChange={(v) => setDraft({ ...draft, tone: v || null })}
        />
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        {savedAt && (
          <span className="text-xs text-muted">
            Saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        )}
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function TextField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint"
      />
    </div>
  );
}

function TextArea({
  label,
  placeholder,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-1">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint resize-y"
      />
    </div>
  );
}

function ListField({
  label,
  help,
  values,
  onChange,
}: {
  label: string;
  help?: string;
  values: string[];
  onChange: (arr: string[]) => void;
}) {
  const text = values.join("\n");
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-1">
        {label}
      </label>
      {help && <p className="text-xs text-muted mb-2">{help}</p>}
      <textarea
        value={text}
        onChange={(e) => {
          const next = e.target.value
            .split(/\n+/)
            .map((s) => s.trim())
            .filter(Boolean);
          onChange(next);
        }}
        rows={Math.max(3, values.length + 1)}
        placeholder="one per line"
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint resize-y"
      />
    </div>
  );
}
