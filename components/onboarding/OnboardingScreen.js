import { useState } from "react";

/**
 * OnboardingScreen — 5-step post-signup wizard ported from
 * OptiMenu Onboarding.dc.html: restaurant profile, pass-tag shipping
 * address, menu photo upload, invoice upload, POS connection.
 *
 * Props
 *   onFinish({ name, addrLine1, addrCity, addrState, addrZip, style, cuisine })
 *                                                 called when step 5 completes
 *   onParseMenu(files) => Promise      called once, with everything added, when
 *                                      Continue is clicked on step 3 — resolves
 *                                      only once the review/commit is actually
 *                                      done (see pages/client/onboarding.js)
 *   onSelectPos(key)                             "square"|"shift4"|"upload" — matches
 *                                                 lib/pos/registry.js's real providers.
 *                                                 (Toast/Clover were listed here previously
 *                                                 but aren't implemented in the registry —
 *                                                 selecting either would hit a real 400 from
 *                                                 /api/pos/oauth-start. Add them back only
 *                                                 once a real provider adapter exists for them.)
 *   onUploadInvoices(files)
 *   NavLink, skipHref (defaults to /client/dashboard), doneHref (defaults to /client/dashboard)
 */
const STEP_LABELS = ["Profile", "Pass tag", "Menu", "Invoices", "POS"];
const POS_LIST = [
  { key: "square", label: "Connect Square POS", mono: "POS" },
  { key: "shift4", label: "Connect Shift4 POS", mono: "POS" },
  { key: "upload", label: "I'll connect this later", mono: "SKIP" },
];

export default function OnboardingScreen({
  onFinish, onParseMenu, parsingMenu, onSelectPos, onUploadInvoices,
  NavLink = DefaultLink, skipHref = "/client/dashboard", doneHref = "/client/dashboard",
}) {
  const [step, setStep] = useState(1);
  const [done, setDone] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [addrLine1, setAddrLine1] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip, setAddrZip] = useState("");
  const [style, setStyle] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [menuFiles, setMenuFiles] = useState([]);
  const [menuDragOver, setMenuDragOver] = useState(false);
  const [posChoice, setPosChoice] = useState(null);

  const addMenuFiles = (fileList) => {
    const newFiles = Array.from(fileList);
    setMenuFiles((prev) => [...prev, ...newFiles]);
    // Deliberately does NOT call onParseMenu here — unlike invoices, a menu
    // parse is one long synchronous request (OCR + a recipe-build call per
    // dish), often a couple of minutes. Firing it per file-add would mean
    // re-parsing repeatedly as someone adds pages one at a time. It fires
    // once, on Continue, with everything they've added — see continueStep.
  };
  const removeMenuFile = (i) => setMenuFiles((prev) => prev.filter((_, idx) => idx !== i));

  const [invoiceFiles, setInvoiceFiles] = useState([]);
  const [invoiceDragOver, setInvoiceDragOver] = useState(false);
  const addInvoiceFiles = (fileList) => {
    const newFiles = Array.from(fileList);
    setInvoiceFiles((prev) => [...prev, ...newFiles]);
    onUploadInvoices?.(newFiles);
  };
  const removeInvoiceFile = (i) => setInvoiceFiles((prev) => prev.filter((_, idx) => idx !== i));

  const inputCls = { width: "100%", background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--text)", fontFamily: "'Manrope',sans-serif", outline: "none" };
  const labelCls = { fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginBottom: 5, display: "block" };
  const stepKicker = { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent-deep)", marginBottom: 8 };
  const stepTitle = { fontSize: 21, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 6 };
  const stepSub = { fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5, marginBottom: 20 };

  const continueStep = async () => {
    if (step === 1 && !name.trim()) { setNameError(true); return; }
    if (step === 3 && menuFiles.length > 0) {
      // Waits for the actual review (commit or discard) to finish before
      // moving on — onParseMenu's promise doesn't resolve until then, see
      // pages/client/onboarding.js.
      await onParseMenu?.(menuFiles);
      setStep((s) => s + 1);
      return;
    }
    if (step === 5) {
      onFinish?.({ name, addrLine1, addrCity, addrState, addrZip, style, cuisine });
      setDone(true);
      return;
    }
    setStep((s) => s + 1);
  };

  return (
    <div
      style={{
        "--panel": "#eef0ef", "--shell": "#ffffff", "--line": "#d8dfe0", "--line-soft": "#eef1f2",
        "--text": "#111819", "--muted": "#4b585b", "--faint": "#78868a",
        "--accent": "#02a4ba", "--accent-deep": "#03808f", "--accent-tint": "#e8f7f9",
        "--shadow-lg": "0 22px 60px rgba(17,24,25,0.12)",
        minHeight: "100vh", display: "flex", flexDirection: "column",
        background: "var(--panel)", color: "var(--text)", fontFamily: "'Manrope',system-ui,sans-serif",
      }}
    >
      <div style={{ background: "var(--shell)", borderBottom: "1px solid var(--line)", padding: "18px 30px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <img src="/landing/logo.png" alt="optiMenu Solutions" style={{ display: "block", height: 20, width: "auto", flexShrink: 0 }} />

        {!done && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {STEP_LABELS.map((label, i) => {
              const n = i + 1;
              const checked = n < step;
              const current = n === step;
              const isLast = n === STEP_LABELS.length;
              return (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, background: checked || current ? "var(--accent)" : "var(--shell)", color: checked || current ? "#fff" : "var(--faint)", border: `1px solid ${checked || current ? "var(--accent)" : "var(--line)"}` }}>
                    {checked ? <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : n}
                  </div>
                  {!isLast && <div style={{ width: 22, height: 1, background: "var(--line)" }} />}
                </div>
              );
            })}
          </div>
        )}

        <NavLink href={skipHref} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)", flexShrink: 0 }}>Skip for now</NavLink>
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "36px 20px" }}>
        <div style={{ width: "100%", maxWidth: 520 }}>

          {done ? (
            <div style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "var(--shadow-lg)", padding: "44px 36px", textAlign: "center" }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--accent-tint)", color: "var(--accent-deep)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.035em", marginBottom: 10 }}>Your kitchen is set up</div>
              <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6, marginBottom: 28 }}>{name || "Your restaurant"} is ready. Come back to Menu items and Invoices anytime to add more.</div>
              <NavLink href={doneHref} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--accent)", color: "#fff", borderRadius: 26, padding: 14, fontSize: 15, fontWeight: 700 }}>
                Go to dashboard
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
              </NavLink>
            </div>
          ) : (
            <div style={{ background: "var(--shell)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "var(--shadow-lg)", padding: "36px 34px" }}>

              {step === 1 && (
                <div>
                  <div style={stepKicker}>Step 1 of 5</div>
                  <div style={stepTitle}>Tell us about your restaurant</div>
                  <div style={stepSub}>This shows up on your invoices and reports.</div>

                  <div style={{ marginBottom: 16 }}>
                    <span style={labelCls}>Restaurant name</span>
                    <input style={inputCls} value={name} onChange={(e) => { setName(e.target.value); setNameError(false); }} placeholder="Luna Osteria" />
                    {nameError && <div style={{ fontSize: 12, color: "#c4473e", marginTop: 5 }}>Enter a restaurant name to continue.</div>}
                  </div>

                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <span style={labelCls}>Style of restaurant</span>
                      <select style={{ ...inputCls, cursor: "pointer" }} value={style} onChange={(e) => setStyle(e.target.value)}>
                        <option value="">Select one</option>
                        <option value="fine">Fine dining</option>
                        <option value="casual">Casual dining</option>
                        <option value="fast-casual">Fast casual</option>
                        <option value="cafe">Cafe &amp; bakery</option>
                        <option value="bar">Bar &amp; lounge</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={labelCls}>Type of food</span>
                      <select style={{ ...inputCls, cursor: "pointer" }} value={cuisine} onChange={(e) => setCuisine(e.target.value)}>
                        <option value="">Select one</option>
                        <option value="italian">Italian</option>
                        <option value="french">French</option>
                        <option value="american">American</option>
                        <option value="mexican">Mexican</option>
                        <option value="japanese">Japanese</option>
                        <option value="chinese">Chinese</option>
                        <option value="indian">Indian</option>
                        <option value="mediterranean">Mediterranean</option>
                        <option value="seafood">Seafood</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <div style={stepKicker}>Step 2 of 5</div>
                  <div style={stepTitle}>Your NFC pass tag is on the way</div>
                  <div style={stepSub}>We ship it same-day or next-day after signup. One passive tag at the pass logs every dish that goes out — no power, no wiring. Where should we send it?</div>

                  <div style={{ marginBottom: 16 }}>
                    <span style={labelCls}>Street address</span>
                    <input style={inputCls} value={addrLine1} onChange={(e) => setAddrLine1(e.target.value)} autoComplete="address-line1" placeholder="214 Mulberry St" />
                  </div>
                  <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                    <div style={{ flex: 2 }}>
                      <span style={labelCls}>City / town</span>
                      <input style={inputCls} value={addrCity} onChange={(e) => setAddrCity(e.target.value)} autoComplete="address-level2" placeholder="New York" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={labelCls}>State</span>
                      <input style={inputCls} value={addrState} onChange={(e) => setAddrState(e.target.value)} autoComplete="address-level1" placeholder="NY" maxLength={2} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={labelCls}>ZIP code</span>
                      <input style={inputCls} value={addrZip} onChange={(e) => setAddrZip(e.target.value)} autoComplete="postal-code" placeholder="10012" />
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel)" }}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--accent-deep)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="1" y="3" width="15" height="13" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>We'll email you tracking once it ships</span>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div>
                  <div style={stepKicker}>Step 3 of 5</div>
                  <div style={stepTitle}>Add photos of your menu</div>
                  <div style={stepSub}>We'll pull dish names, prices and listed ingredients from these, then have our AI draft a first-pass recipe for each dish. We'll follow up with you to confirm the real recipes.</div>

                  <label
                    onDragOver={(e) => { e.preventDefault(); setMenuDragOver(true); }}
                    onDragLeave={() => setMenuDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setMenuDragOver(false);
                      if (e.dataTransfer.files?.length) addMenuFiles(e.dataTransfer.files);
                    }}
                    style={{
                      display: "block",
                      border: `1.5px dashed ${menuDragOver ? "var(--accent-deep)" : "var(--line)"}`,
                      borderRadius: 12,
                      padding: 22,
                      textAlign: "center",
                      background: menuDragOver ? "var(--accent-tint)" : "var(--panel)",
                      marginBottom: 16,
                      cursor: "pointer",
                      transition: "border-color .15s, background .15s",
                    }}
                  >
                    <input
                      type="file"
                      multiple
                      accept="application/pdf,image/*"
                      style={{ display: "none" }}
                      onChange={(e) => { addMenuFiles(e.target.files); e.target.value = ""; }}
                    />
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 6 }}>Drag files here</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>or click to browse — PDF, JPG or PNG, as many pages as you need</div>
                  </label>

                  {menuFiles.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 4 }}>
                      {menuFiles.map((f, i) => (
                        <div key={i} style={{ position: "relative", height: 90, borderRadius: 8, border: "1px solid var(--line)", background: "var(--shell)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: 6, overflow: "hidden" }}>
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent-deep)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>
                          <span style={{ fontSize: 10.5, color: "var(--muted)", textAlign: "center", wordBreak: "break-word", lineHeight: 1.3 }}>{f.name}</span>
                          <button
                            type="button"
                            onClick={() => removeMenuFile(i)}
                            aria-label={`Remove ${f.name}`}
                            style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: "50%", border: "none", background: "var(--panel)", color: "var(--faint)", fontSize: 12, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {step === 4 && (
                <div>
                  <div style={stepKicker}>Step 4 of 5</div>
                  <div style={stepTitle}>Got any invoices on hand?</div>
                  <div style={stepSub}>We read supplier, date and every line item from what you upload, then re-cost your menu automatically. No rush — you can always add these later from Invoices.</div>

                  <label
                    onDragOver={(e) => { e.preventDefault(); setInvoiceDragOver(true); }}
                    onDragLeave={() => setInvoiceDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setInvoiceDragOver(false);
                      if (e.dataTransfer.files?.length) addInvoiceFiles(e.dataTransfer.files);
                    }}
                    style={{
                      display: "block",
                      border: `1.5px dashed ${invoiceDragOver ? "var(--accent-deep)" : "var(--line)"}`,
                      borderRadius: 12,
                      padding: 22,
                      textAlign: "center",
                      background: invoiceDragOver ? "var(--accent-tint)" : "var(--panel)",
                      marginBottom: 16,
                      cursor: "pointer",
                      transition: "border-color .15s, background .15s",
                    }}
                  >
                    <input
                      type="file"
                      multiple
                      accept="application/pdf,image/*"
                      style={{ display: "none" }}
                      onChange={(e) => { addInvoiceFiles(e.target.files); e.target.value = ""; }}
                    />
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 6 }}>Drag files here</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>or click to browse — PDF, JPG or PNG</div>
                  </label>

                  {invoiceFiles.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
                      {invoiceFiles.map((f, i) => (
                        <div key={i} style={{ position: "relative", height: 90, borderRadius: 8, border: "1px solid var(--line)", background: "var(--shell)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: 6, overflow: "hidden" }}>
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent-deep)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>
                          <span style={{ fontSize: 10.5, color: "var(--muted)", textAlign: "center", wordBreak: "break-word", lineHeight: 1.3 }}>{f.name}</span>
                          <button
                            type="button"
                            onClick={() => removeInvoiceFile(i)}
                            aria-label={`Remove ${f.name}`}
                            style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: "50%", border: "none", background: "var(--panel)", color: "var(--faint)", fontSize: 12, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button type="button" onClick={continueStep} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent-deep)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                    Skip for now — I'll upload invoices later
                  </button>
                </div>
              )}

              {step === 5 && (
                <div>
                  <div style={stepKicker}>Step 5 of 5</div>
                  <div style={stepTitle}>Connect your POS</div>
                  <div style={stepSub}>Link your point-of-sale system and we'll pull in sales data automatically to power recommendations and analytics.</div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {POS_LIST.map((opt) => {
                      const selected = posChoice === opt.key;
                      return (
                        <button
                          key={opt.key} type="button"
                          onClick={() => { setPosChoice(opt.key); onSelectPos?.(opt.key); }}
                          style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", background: selected ? "var(--accent-tint)" : "var(--shell)", border: `1px solid ${selected ? "var(--accent)" : "var(--line)"}`, borderRadius: 10, padding: "13px 14px", cursor: "pointer", fontFamily: "'Manrope',sans-serif" }}
                        >
                          <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--panel)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, fontWeight: 700, color: "var(--muted)" }}>{opt.mono}</div>
                          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{opt.label}</span>
                          {selected && <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--accent-deep)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 30, paddingTop: 24, borderTop: "1px solid var(--line-soft)" }}>
                {step > 1 ? (
                  <button type="button" onClick={() => setStep((s) => Math.max(1, s - 1))} style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--text)", borderRadius: 24, padding: "12px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Back</button>
                ) : <span />}
                <button
                  type="button"
                  onClick={continueStep}
                  disabled={parsingMenu}
                  style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 24, padding: "12px 26px", fontSize: 14, fontWeight: 700, cursor: parsingMenu ? "default" : "pointer", opacity: parsingMenu ? 0.6 : 1 }}
                >
                  {parsingMenu ? "Reading your menu…" : step === 5 ? "Finish setup" : "Continue"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DefaultLink({ href, children, style }) {
  return <a href={href} style={style}>{children}</a>;
}