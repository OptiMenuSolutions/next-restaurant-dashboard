import { useState } from "react";
import { useAccountChrome, CSS as CHROME_CSS } from "./AccountChrome";

/**
 * ProfileScreen — ported from OptiMenu Profile.dc.html. Presentational;
 * pages/client/profile.js wires the real user/restaurant data and Supabase
 * calls in for each save handler.
 *
 * Props
 *   user            { name, email }
 *   restaurantName  string
 *   targetFoodCost  number (percent)
 *   notifPrefs      { weekly, priceAlert, lowMargin }
 *   onSaveName / onSaveRestaurant / onSaveFoodCost / onSavePassword  (value) => Promise|void
 *   onToggleNotif   (key, next) => void
 *   onExportData    () => Promise|void
 *   onDeleteAccount () => Promise|void
 *   onSendFeedback  (text) => Promise|void
 *   onRestartTour   () => void
 *   onSignOut       () => void
 *   NavLink         component, defaults to <a>
 *   initialTab      "account" | "restaurant" | "notifications" | "support"
 */
export default function ProfileScreen({
  user = { name: "Marco Rossi", email: "marco@lunaosteria.com" },
  restaurantName: restaurantNameProp = "Luna Osteria",
  targetFoodCost: targetFoodCostProp = 30,
  notifPrefs = { weekly: true, priceAlert: true, lowMargin: false },
  onSaveName, onSaveRestaurant, onSaveFoodCost, onSavePassword,
  onToggleNotif, onExportData, onDeleteAccount, onSendFeedback, onRestartTour,
  onSignOut, NavLink, initialTab = "account",
}) {
  const { header, theme } = useAccountChrome({ user, NavLink, onSignOut });

  const [activeTab, setActiveTab] = useState(initialTab);
  const [restaurantName, setRestaurantName] = useState(restaurantNameProp);
  const [targetFoodCost, setTargetFoodCost] = useState(targetFoodCostProp);
  const [notifs, setNotifs] = useState(notifPrefs);
  const [message, setMessage] = useState(null); // { text, isError }
  const [editing, setEditing] = useState(null); // "name" | "restaurant" | "foodCost" | "password"
  const [temp, setTemp] = useState({ name: "", restaurant: "", foodCost: "", password: "", passwordConfirm: "" });
  const [exporting, setExporting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);

  const flash = (text, isError) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 3500);
  };

  const initials = (user.name || "U").split(" ").map((p) => p.charAt(0)).join("").substring(0, 2).toUpperCase();

  const card = { background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--card-lift)", overflow: "hidden", marginBottom: 16 };
  const cardHead = { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)", padding: "13px 18px", borderBottom: "1px solid var(--line-soft)" };
  const rowLabel = { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--faint)" };
  const editBtn = { border: "none", background: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--accent-deep)", padding: 0 };
  const pfInput = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px", fontSize: 14, color: "var(--text)", fontFamily: "'Manrope',sans-serif", outline: "none" };
  const saveBtn = { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
  const cancelBtn = { background: "none", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 15px", fontSize: 13, fontWeight: 600, color: "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" };

  const tabs = [
    { id: "account", label: "Account" },
    { id: "restaurant", label: "Restaurant" },
    { id: "notifications", label: "Notifications" },
    { id: "support", label: "Support" },
  ];

  const notifRows = [
    { key: "weekly", label: "Weekly cost summary", sub: "Email every Monday with your top cost changes" },
    { key: "priceAlert", label: "Ingredient price alerts", sub: "When an ingredient price rises more than 10%" },
    { key: "lowMargin", label: "Low margin alerts", sub: "When menu items drop below your target food cost" },
  ];

  return (
    <div className="om-acct" data-theme={theme} style={{ width: "100%", minHeight: "100vh" }}>
      {header}

      <div style={{ background: "var(--panel)", minHeight: "calc(100vh - 41px)", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 20px 60px" }}>
        <div style={{ width: "100%", maxWidth: 640, paddingTop: 24 }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 5 }}>Account settings</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1, marginBottom: 16 }}>Profile &amp; settings</div>

          <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 20, padding: 3, marginBottom: 16, overflowX: "auto" }}>
            {tabs.map((t) => (
              <button
                key={t.id} type="button" onClick={() => setActiveTab(t.id)}
                style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700, borderRadius: 16, padding: "8px 15px", whiteSpace: "nowrap", background: activeTab === t.id ? "var(--accent-tint)" : "transparent", color: activeTab === t.id ? "var(--accent-deep)" : "var(--muted)" }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {message && (
            <div style={{ marginBottom: 14, padding: "11px 15px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: message.isError ? "var(--red-tint)" : "var(--accent-tint)", border: `1px solid ${message.isError ? "var(--red)" : "var(--accent)"}`, color: message.isError ? "var(--red)" : "var(--accent-deep)" }}>
              {message.text}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: 20, ...card, marginBottom: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 700, flexShrink: 0 }}>{initials}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>{user.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 2 }}>{user.email}</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 10px", borderRadius: 20, background: "var(--accent-tint)", color: "var(--accent-deep)" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }} />Founding member
              </div>
            </div>
          </div>

          {activeTab === "account" && (
            <div>
              <div style={card}>
                <div style={cardHead}>Account information</div>

                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-soft)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={rowLabel}>Full name</div>
                    {editing !== "name" && <button type="button" style={editBtn} onClick={() => { setEditing("name"); setTemp((t) => ({ ...t, name: user.name })); }}>Edit</button>}
                  </div>
                  {editing === "name" ? (
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <input className="pf-input" style={{ ...pfInput, flex: 1, minWidth: 0 }} value={temp.name} onChange={(e) => setTemp((t) => ({ ...t, name: e.target.value }))} placeholder="Your full name" />
                      <button type="button" style={saveBtn} onClick={async () => { if (!temp.name.trim()) return; await onSaveName?.(temp.name.trim()); setEditing(null); flash("Name updated"); }}>Save</button>
                      <button type="button" style={cancelBtn} onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 14.5, fontWeight: 600 }}>{user.name}</div>
                  )}
                </div>

                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-soft)" }}>
                  <div style={{ ...rowLabel, marginBottom: 4 }}>Email address</div>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{user.email}</div>
                </div>

                <div style={{ padding: "14px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={rowLabel}>Password</div>
                    {editing !== "password" && <button type="button" style={editBtn} onClick={() => setEditing("password")}>Change</button>}
                  </div>
                  {editing === "password" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                      <input type="password" className="pf-input" style={pfInput} value={temp.password} onChange={(e) => setTemp((t) => ({ ...t, password: e.target.value }))} placeholder="New password (min 8 chars)" />
                      <input type="password" className="pf-input" style={pfInput} value={temp.passwordConfirm} onChange={(e) => setTemp((t) => ({ ...t, passwordConfirm: e.target.value }))} placeholder="Confirm new password" />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" style={saveBtn} onClick={async () => {
                          if (!temp.password || temp.password !== temp.passwordConfirm) { flash("Passwords do not match", true); return; }
                          if (temp.password.length < 8) { flash("Password must be at least 8 characters", true); return; }
                          await onSavePassword?.(temp.password);
                          setEditing(null); setTemp((t) => ({ ...t, password: "", passwordConfirm: "" }));
                          flash("Password updated");
                        }}>Update password</button>
                        <button type="button" style={cancelBtn} onClick={() => { setEditing(null); setTemp((t) => ({ ...t, password: "", passwordConfirm: "" })); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 14.5, color: "var(--faint)", letterSpacing: "0.1em" }}>••••••••••</div>
                  )}
                </div>
              </div>

              <div style={card}>
                <div style={cardHead}>Billing</div>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-soft)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                    <div style={rowLabel}>Current plan</div>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 600, color: "var(--accent-deep)" }}>$59 / month</div>
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>Founding member</div>
                  <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 4, lineHeight: 1.5 }}>Locked-in rate for life. Renews monthly.</div>
                </div>
                <NavLink href="/client/billing" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", color: "var(--text)" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Manage billing</div>
                    <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2 }}>Update payment method, view invoices</div>
                  </div>
                  <div style={{ color: "var(--faint)", flexShrink: 0 }}>→</div>
                </NavLink>
              </div>

              <div style={card}>
                <div style={cardHead}>Data &amp; privacy</div>
                <div onClick={async () => { setExporting(true); await onExportData?.(); setExporting(false); flash("Data exported successfully"); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", cursor: "pointer", borderBottom: "1px solid var(--line-soft)" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{exporting ? "Exporting…" : "Export my data"}</div>
                    <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2 }}>Download all your invoices, ingredients &amp; menu items as JSON</div>
                  </div>
                  <div style={{ color: "var(--faint)", flexShrink: 0 }}>↓</div>
                </div>
                <div onClick={() => setShowDeleteModal(true)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", cursor: "pointer" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--red)" }}>Delete account</div>
                    <div style={{ fontSize: 12, color: "var(--red)", opacity: 0.7, marginTop: 2 }}>Permanently delete all data — cannot be undone</div>
                  </div>
                  <div style={{ color: "var(--red)", flexShrink: 0 }}>→</div>
                </div>
              </div>

              <button type="button" onClick={onSignOut} style={{ width: "100%", padding: 13, borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope',sans-serif", background: "none", color: "var(--red)", border: "1px solid var(--red)", opacity: 0.85, marginBottom: 20 }}>
                Sign out
              </button>
            </div>
          )}

          {activeTab === "restaurant" && (
            <div style={{ ...card, marginBottom: 20 }}>
              <div style={cardHead}>Restaurant settings</div>

              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-soft)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={rowLabel}>Restaurant name</div>
                  {editing !== "restaurant" && <button type="button" style={editBtn} onClick={() => { setEditing("restaurant"); setTemp((t) => ({ ...t, restaurant: restaurantName })); }}>Edit</button>}
                </div>
                {editing === "restaurant" ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <input className="pf-input" style={{ ...pfInput, flex: 1, minWidth: 0 }} value={temp.restaurant} onChange={(e) => setTemp((t) => ({ ...t, restaurant: e.target.value }))} placeholder="Restaurant name" />
                    <button type="button" style={saveBtn} onClick={async () => { if (!temp.restaurant.trim()) return; await onSaveRestaurant?.(temp.restaurant.trim()); setRestaurantName(temp.restaurant.trim()); setEditing(null); flash("Restaurant name updated"); }}>Save</button>
                    <button type="button" style={cancelBtn} onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{restaurantName}</div>
                )}
              </div>

              <div style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={rowLabel}>Target food cost %</div>
                  {editing !== "foodCost" && <button type="button" style={editBtn} onClick={() => { setEditing("foodCost"); setTemp((t) => ({ ...t, foodCost: String(targetFoodCost) })); }}>Edit</button>}
                </div>
                {editing === "foodCost" ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <input type="number" min="1" max="99" className="pf-input" style={{ ...pfInput, flex: 1, minWidth: 0 }} value={temp.foodCost} onChange={(e) => setTemp((t) => ({ ...t, foodCost: e.target.value }))} placeholder="e.g. 30" />
                    <button type="button" style={saveBtn} onClick={async () => {
                      const val = parseFloat(temp.foodCost);
                      if (isNaN(val) || val < 1 || val > 99) return;
                      await onSaveFoodCost?.(val); setTargetFoodCost(val); setEditing(null); flash("Target food cost updated");
                    }}>Save</button>
                    <button type="button" style={cancelBtn} onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--accent-deep)" }}>{targetFoodCost}%</div>
                )}
                <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 8, lineHeight: 1.5 }}>Menu items with food cost above this threshold are flagged as low margin across the app.</div>
              </div>
            </div>
          )}

          {activeTab === "notifications" && (
            <div style={{ ...card, marginBottom: 20 }}>
              <div style={cardHead}>Email notifications</div>
              {notifRows.map((r) => (
                <div key={r.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "14px 18px", borderBottom: "1px solid var(--line-soft)" }}>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 600 }}>{r.label}</div>
                    <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3 }}>{r.sub}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { const next = !notifs[r.key]; setNotifs((n) => ({ ...n, [r.key]: next })); onToggleNotif?.(r.key, next); flash("Preference saved"); }}
                    style={{ width: 38, height: 22, borderRadius: 11, position: "relative", border: "none", cursor: "pointer", flexShrink: 0, background: notifs[r.key] ? "var(--accent)" : "var(--line)" }}
                  >
                    <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: notifs[r.key] ? 18 : 2, transition: "left .2s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {activeTab === "support" && (
            <div>
              <div onClick={onRestartTour} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", ...card, cursor: "pointer" }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Restart tour</div>
                <div style={{ color: "var(--faint)" }}>→</div>
              </div>

              <div style={card}>
                <div style={cardHead}>Send feedback</div>
                <div style={{ padding: "14px 18px" }}>
                  <div style={{ ...rowLabel, marginBottom: 8 }}>What's on your mind?</div>
                  <textarea className="pf-input" rows={4} style={{ ...pfInput, width: "100%", resize: "vertical", lineHeight: 1.5 }} value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder="Feature requests, bugs, or anything else..." />
                  <button
                    type="button" disabled={!feedbackText.trim()}
                    onClick={async () => { if (!feedbackText.trim()) return; await onSendFeedback?.(feedbackText); setFeedbackText(""); setFeedbackSent(true); setTimeout(() => setFeedbackSent(false), 3000); }}
                    style={{ marginTop: 10, width: "100%", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: 11, fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: feedbackText.trim() ? 1 : 0.5 }}
                  >
                    {feedbackSent ? "✓ Sent — thank you!" : "Send feedback"}
                  </button>
                </div>
              </div>

              <div style={card}>
                <div style={cardHead}>Contact</div>
                <a href="mailto:support@opti-menu.com" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--line-soft)", color: "var(--text)" }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Email support</div>
                  <div style={{ color: "var(--faint)" }}>→</div>
                </a>
                <a href="https://www.opti-menu.com" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", color: "var(--text)" }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Visit opti-menu.com</div>
                  <div style={{ color: "var(--faint)" }}>→</div>
                </a>
              </div>

              <div style={{ textAlign: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, letterSpacing: "0.08em", color: "var(--faint)", marginBottom: 20 }}>OptiMenu · Founding member plan · v1.0</div>
            </div>
          )}
        </div>
      </div>

      {showDeleteModal && (
        <div onClick={() => setShowDeleteModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(10,14,15,0.55)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--shadow-lg)", padding: 24, maxWidth: 400, width: "100%" }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Delete account</div>
            <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, marginBottom: 20 }}>
              This will permanently delete your account, restaurant, all invoices, ingredients, and menu items. <strong style={{ color: "var(--red)" }}>This cannot be undone.</strong>
              <br /><br />If you'd like to keep your data, export it first from the Data &amp; Privacy section.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowDeleteModal(false)} style={cancelBtn}>Cancel</button>
              <button type="button" onClick={async () => { setShowDeleteModal(false); await onDeleteAccount?.(); flash("Account deletion requested"); }} style={{ background: "var(--red)", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer" }}>
                Yes, delete everything
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{CHROME_CSS}</style>
    </div>
  );
}
