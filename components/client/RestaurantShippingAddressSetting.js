import { useState } from "react";

const FIELDS = [
  ["shipping_address_line1", "Street address", "address-line1"],
  ["shipping_city", "City / town", "address-level2"],
  ["shipping_state", "State", "address-level1"],
  ["shipping_zip", "ZIP code", "postal-code"],
];
const buttonStyle = {
  border: "1px solid var(--line)", borderRadius: 7,
  padding: "7px 11px", background: "var(--shell, #fff)",
  color: "var(--text)", font: "inherit", fontSize: 12,
  fontWeight: 700, cursor: "pointer",
};

export default function RestaurantShippingAddressSetting({
  address = null, timeZone = null, onSave,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [expected, setExpected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function beginEditing() {
    setDraft(Object.fromEntries(FIELDS.map(([key]) => [key, address?.[key] || ""])));
    setExpected({
      ...Object.fromEntries(FIELDS.map(([key]) => [key, address?.[key] ?? null])),
      operational_timezone: timeZone,
    });
    setError("");
    setSaved(false);
    setEditing(true);
  }

  async function save(event) {
    event.preventDefault();
    if (!onSave || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(draft, expected);
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(err?.message || "Could not save the shipping address.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Shipping address</div>
        {!editing && onSave && (
          <button type="button" style={buttonStyle} onClick={beginEditing}>
            {address?.shipping_address_line1 ? "Edit" : "Add address"}
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
            {FIELDS.map(([key, label, autocomplete]) => (
              <div key={key} style={{ flex: key === "shipping_address_line1" ? "1 1 100%" : "1 1 120px", minWidth: 0 }}>
                <label htmlFor={"restaurant-" + key} style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
                  {label}
                </label>
                <input
                  id={"restaurant-" + key}
                  className="pf-input"
                  value={draft[key] || ""}
                  autoComplete={autocomplete}
                  required
                  disabled={saving}
                  maxLength={key === "shipping_state" ? 2 : key === "shipping_zip" ? 10 : key === "shipping_address_line1" ? 200 : 100}
                  pattern={key === "shipping_zip" ? "[0-9]{5}(-[0-9]{4})?" : key === "shipping_state" ? "[A-Za-z]{2}" : undefined}
                  onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}
                  style={{ width: "100%", boxSizing: "border-box", padding: 9, borderRadius: 7, font: "inherit" }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="submit" style={buttonStyle} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" style={buttonStyle} disabled={saving} onClick={() => { setEditing(false); setError(""); }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.5 }}>
          <div>{address?.shipping_address_line1 || "Not provided"}</div>
          <div>{[address?.shipping_city, address?.shipping_state, address?.shipping_zip].filter(Boolean).join(" ")}</div>
        </div>
      )}
      {error && <div role="alert" style={{ marginTop: 8, color: "var(--red, #b83c33)", fontSize: 12 }}>{error}</div>}
      {saved && <div role="status" style={{ marginTop: 8, fontSize: 12 }}>Shipping address saved.</div>}
    </div>
  );
}