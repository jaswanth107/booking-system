import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type ResourceInput } from "../../api/client";
import type { Resource, ResourceStatus } from "../../types";

const EMPTY_FORM: ResourceInput = {
  name: "",
  location: "",
  bestForUse: "",
  description: "",
  capacity: undefined,
  facilities: [],
  imageUrl: ""
};

function isBlank(v: string) {
  return v.trim() === "";
}

export function AdminResources() {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ResourceInput>(EMPTY_FORM);
  const [facilitiesText, setFacilitiesText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    api.admin
      .listResources()
      .then(({ resources }) => setResources(resources))
      .catch(() => setError("Could not load resources."));
  }

  useEffect(load, []);

  const formValid = useMemo(
    () => !isBlank(form.name) && !isBlank(form.location) && !isBlank(form.bestForUse) && !isBlank(form.description),
    [form]
  );

  function resetForm() {
    setForm(EMPTY_FORM);
    setFacilitiesText("");
    setEditingId(null);
  }

  function startEdit(r: Resource) {
    setEditingId(r.id);
    setForm({
      name: r.name,
      location: r.location,
      bestForUse: r.bestForUse,
      description: r.description,
      capacity: r.capacity ?? undefined,
      facilities: r.facilities,
      imageUrl: r.imageUrl ?? ""
    });
    setFacilitiesText(r.facilities.join(", "));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    setSubmitting(true);
    setError(null);
    const payload: ResourceInput = {
      ...form,
      facilities: facilitiesText
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
      capacity: form.capacity === undefined || form.capacity === null || (form.capacity as unknown as string) === "" ? null : Number(form.capacity),
      imageUrl: form.imageUrl?.trim() || null
    };
    try {
      if (editingId) {
        await api.admin.updateResource(editingId, payload);
      } else {
        await api.admin.createResource(payload);
      }
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save resource.");
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(id: string, status: ResourceStatus) {
    setError(null);
    try {
      await api.admin.setResourceStatus(id, status);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update status.");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.admin.deleteResource(id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete resource.");
    }
  }

  return (
    <div>
      <h2>{editingId ? "Edit resource" : "Add resource"}</h2>
      {error && <p className="notice notice-error">{error}</p>}
      <form className="booking-form" style={{ maxWidth: 480 }} onSubmit={handleSubmit}>
        <label>
          Place name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          Landmark
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} required />
        </label>
        <label>
          Best for use
          <input value={form.bestForUse} onChange={(e) => setForm({ ...form, bestForUse: e.target.value })} required />
        </label>
        <label>
          Description
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required rows={3} />
        </label>
        <label>
          Capacity (optional)
          <input
            type="number"
            min={0}
            value={form.capacity ?? ""}
            onChange={(e) => setForm({ ...form, capacity: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </label>
        <label>
          Facilities (comma separated, optional)
          <input value={facilitiesText} onChange={(e) => setFacilitiesText(e.target.value)} placeholder="Wi-Fi, Projector, TV" />
        </label>
        <label>
          Image URL (optional)
          <input value={form.imageUrl ?? ""} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://…" />
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="button" data-testid="save-resource" disabled={!formValid || submitting}>
            {submitting ? "Saving…" : editingId ? "Save changes" : "Add resource"}
          </button>
          {editingId && (
            <button type="button" className="button button-secondary" onClick={resetForm}>
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <h2 style={{ marginTop: 32 }}>Resources</h2>
      {!resources ? (
        <p>Loading…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Landmark</th>
                <th>Capacity</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.location}</td>
                  <td>{r.capacity ?? "—"}</td>
                  <td>
                    <span className={`badge badge-${r.status.toLowerCase()}`}>{r.status}</span>
                  </td>
                  <td className="admin-row-actions">
                    <button className="button button-secondary" onClick={() => startEdit(r)}>
                      Edit
                    </button>
                    {r.status !== "AVAILABLE" && (
                      <button className="button button-secondary" onClick={() => setStatus(r.id, "AVAILABLE")}>
                        Enable
                      </button>
                    )}
                    {r.status !== "MAINTENANCE" && (
                      <button className="button button-secondary" onClick={() => setStatus(r.id, "MAINTENANCE")}>
                        Maintenance
                      </button>
                    )}
                    {r.status !== "DISABLED" && (
                      <button className="button button-secondary" onClick={() => setStatus(r.id, "DISABLED")}>
                        Disable
                      </button>
                    )}
                    <button className="button button-secondary" onClick={() => remove(r.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
