import { useState } from 'react';
import { UNITS } from '../../lib/recipes/compile';
import Picker from './Picker';

const MONO = "'IBM Plex Mono', ui-monospace, monospace";

const field = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  minHeight: 40,
  padding: '0 12px',
  border: '1px solid var(--line)',
  borderRadius: 10,
  background: 'var(--shell)',
  color: 'var(--text)',
  font: "500 14px 'Manrope', sans-serif",
};

const button = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: 40,
  padding: '0 16px',
  border: '1px solid var(--line)',
  borderRadius: 20,
  background: 'var(--shell)',
  color: 'var(--text)',
  font: "600 13px 'Manrope', sans-serif",
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const primary = {
  ...button,
  border: 0,
  background: 'var(--accent-deep)',
  color: 'var(--on-accent, #ffffff)',
  fontWeight: 700,
};

const kicker = {
  fontFamily: MONO,
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
};

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12.5,
  fontWeight: 600,
  color: 'var(--muted)',
};

const title = { fontSize: 14.5, fontWeight: 700 };
const sub = { margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' };

// Size of each unit in grams (w) or milliliters (v), for scaling a batch.
const UNIT_BASE = {
  g: ['w', 1], gram: ['w', 1], grams: ['w', 1],
  kg: ['w', 1000],
  oz: ['w', 28.3495], ounce: ['w', 28.3495],
  lb: ['w', 453.592], lbs: ['w', 453.592], pound: ['w', 453.592],
  ml: ['v', 1],
  l: ['v', 1000], liter: ['v', 1000],
  tsp: ['v', 4.92892],
  tbsp: ['v', 14.7868],
  'fl oz': ['v', 29.5735], fl_oz: ['v', 29.5735], floz: ['v', 29.5735],
  cup: ['v', 236.588], cups: ['v', 236.588],
  pt: ['v', 473.176], pint: ['v', 473.176],
  qt: ['v', 946.353], quart: ['v', 946.353],
  gal: ['v', 3785.41], gallon: ['v', 3785.41],
};

// Share of the finished batch that one portion uses, or null if the
// units can't be compared.
export function batchShare(quantity, unit, yieldQuantity, yieldUnit) {
  const q = Number(quantity);
  const y = Number(yieldQuantity);

  if (!(q > 0) || !(y > 0)) return null;

  const a = String(unit || '').toLowerCase();
  const b = String(yieldUnit || '').toLowerCase();

  if (a === b) return q / y;

  const ua = UNIT_BASE[a];
  const ub = UNIT_BASE[b];

  if (!ua || !ub || ua[0] !== ub[0]) return null;

  return (q * ua[1]) / (y * ub[1]);
}

const round = n => String(Math.round(n * 100) / 100);
const norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

function shareText(share) {
  const inverse = 1 / share;
  return share < 1 && Math.abs(inverse - Math.round(inverse)) < 0.05
    ? `1/${Math.round(inverse)}`
    : `${round(share * 100)}%`;
}

const UNIT_OPTIONS = UNITS.map(unit => ({ value: unit, label: unit }));
const PORTION_UNIT = { lb: 'oz', lbs: 'oz', kg: 'g' };
const emptyLine = () => ({ name: '', ingredient_id: null, prep_id: null, quantity: '', unit: 'oz' });
const STEPS = ['Batch preps', 'Components', 'Recipes'];

function Icon({ d, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );
}

const X = <path d="M6 6l12 12M18 6L6 18" />;
const CHECK = <path d="M5 12.5l4.5 4.5L19 7.5" />;
const PLUS = <path d="M12 5v14M5 12h14" />;

export default function RecipeBuilder({
  dish,
  nodes,
  ingredients,
  busy,
  phone,
  onDirty,
  onSavePrep,
  onSave,
  onClose,
}) {
  const [step, setStep] = useState(1);
  const [used, setUsed] = useState([]);
  const [prep, setPrep] = useState(null);
  const [parts, setParts] = useState([]);
  const [typed, setTyped] = useState('');

  const preps = nodes.filter(n => n.kind === 'prep');
  const defOf = node => node?.published || node?.draft || null;
  const prepNamed = name => preps.find(p => norm(p.name) === norm(name));
  const touch = () => onDirty?.();
  const cols = phone ? 'minmax(0, 1fr) 64px 76px 36px' : 'minmax(0, 2fr) 90px 96px 36px';

  const ingredientOptions = ingredients.map(i => ({
    value: i.id,
    label: i.name,
    meta: i.unit,
    group: 'Ingredients',
  }));

  const batchPart = p => {
    const yieldUnit = defOf(p)?.yield_unit || 'oz';
    return {
      name: p.name,
      prep_id: p.id,
      quantity: '',
      unit: PORTION_UNIT[String(yieldUnit).toLowerCase()] || yieldUnit,
      lines: [],
    };
  };

  function ingredientRow(line, change, remove, key) {
    return (
      <div key={key} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center' }}>
        <Picker
          ariaLabel="Ingredient"
          value={line.ingredient_id || ''}
          text={line.name}
          placeholder="Choose or type an ingredient"
          options={ingredientOptions}
          onChange={(id, option) => change({ ingredient_id: id, name: option.label, unit: option.meta || line.unit })}
          onCreate={name => change({ ingredient_id: null, name })}
        />
        <input
          style={{ ...field, fontFamily: MONO, textAlign: 'right' }}
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          aria-label={`${line.name || 'Ingredient'} amount`}
          value={line.quantity}
          onChange={e => change({ quantity: e.target.value })}
        />
        <Picker
          ariaLabel={`${line.name || 'Ingredient'} unit`}
          value={line.unit}
          text={line.unit}
          options={UNIT_OPTIONS}
          search={false}
          onChange={unit => change({ unit })}
        />
        <button
          type="button"
          aria-label={`Remove ${line.name || 'ingredient'}`}
          onClick={remove}
          style={{ width: 36, height: 36, border: '1px solid var(--line)', borderRadius: '50%', background: 'transparent', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <Icon d={X} size={13} />
        </button>
      </div>
    );
  }

  // Step 1 · batch preps
  const editPrep = changes => {
    touch();
    setPrep(old => ({ ...old, ...changes }));
  };

  const editPrepLine = (index, changes) => editPrep({
    lines: prep.lines.map((line, i) => (i === index ? { ...line, ...changes } : line)),
  });

  const prepLines = prep ? prep.lines.filter(line => line.ingredient_id || line.name.trim()) : [];
  const prepTaken = !!prep && !!prepNamed(prep.name);
  const prepReady = !!prep
    && !!prep.name.trim()
    && !prepTaken
    && Number(prep.yield_quantity) > 0
    && prepLines.length > 0
    && prepLines.every(line => Number(line.quantity) > 0);

  function toggleUsed(id) {
    touch();
    setUsed(old => (old.includes(id) ? old.filter(x => x !== id) : [...old, id]));
  }

  async function saveBatch() {
    const name = prep.name.trim();
    const result = await onSavePrep({
      kind: 'prep',
      name,
      notes: '',
      draft: {
        yield_quantity: prep.yield_quantity,
        yield_unit: prep.yield_unit,
        lines: prepLines.map(line => ({ ...line, component: 'Recipe' })),
      },
    });

    if (!result) return;

    const saved = [...result.state.nodes]
      .reverse()
      .find(n => n.kind === 'prep' && norm(n.name) === norm(name));

    if (saved) setUsed(old => (old.includes(saved.id) ? old : [...old, saved.id]));
    setPrep(null);
  }

  function toComponents() {
    const names = new Set(parts.map(part => norm(part.name)));
    const added = used
      .map(id => preps.find(p => p.id === id))
      .filter(p => p && !names.has(norm(p.name)))
      .map(batchPart);

    setParts([...parts, ...added]);
    setStep(2);
  }

  // Step 2 · components
  function addPart(raw) {
    const name = raw.trim();
    setTyped('');

    if (!name || parts.some(part => norm(part.name) === norm(name))) return;

    const match = prepNamed(name);
    touch();
    setParts(old => [
      ...old,
      match
        ? batchPart(match)
        : { name, prep_id: null, quantity: '', unit: 'oz', lines: [emptyLine()] },
    ]);
  }

  const removePart = index => {
    touch();
    setParts(old => old.filter((_, i) => i !== index));
  };

  const suggestions = typed.trim()
    ? preps
      .filter(p => norm(p.name).includes(norm(typed)) && !parts.some(part => part.prep_id === p.id))
      .slice(0, 5)
    : [];

  // Step 3 · recipes
  const changePart = (index, changes) => {
    touch();
    setParts(old => old.map((part, i) => (i === index ? { ...part, ...changes } : part)));
  };

  const changeLine = (partIndex, lineIndex, changes) => changePart(partIndex, {
    lines: parts[partIndex].lines.map((line, i) => (i === lineIndex ? { ...line, ...changes } : line)),
  });

  const lines = parts.flatMap(part => (part.prep_id
    ? [{
      prep_id: part.prep_id,
      ingredient_id: null,
      name: part.name,
      quantity: part.quantity,
      unit: part.unit,
      component: part.name,
    }]
    : part.lines
      .filter(line => line.ingredient_id || line.name.trim())
      .map(line => ({ ...line, prep_id: null, component: part.name }))));

  const chip = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    padding: '0 12px',
    borderRadius: 16,
    fontSize: 13,
    fontWeight: 600,
  };

  function batchCard(part, index) {
    const p = preps.find(x => x.id === part.prep_id);
    const def = defOf(p);
    const share = batchShare(part.quantity, part.unit, def?.yield_quantity, def?.yield_unit);

    return (
      <div key={part.name} style={{ border: '1.5px solid var(--accent)', borderRadius: 12 }}>
        <div style={{ padding: '10px 14px', background: 'var(--accent-tint)', borderRadius: '11px 11px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>{part.name}</span>
          <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.08em', borderRadius: 5, padding: '2px 6px', background: 'var(--shell)', color: 'var(--accent-deep)', whiteSpace: 'nowrap' }}>YOUR BATCH PREP</span>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13.5 }}>How much {part.name} goes on one plate?</div>
          <div style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0, 1fr) 96px' : '120px 110px', gap: 8 }}>
            <input
              style={{ ...field, fontFamily: MONO, textAlign: 'right' }}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              aria-label={`${part.name} per plate`}
              value={part.quantity}
              onChange={e => changePart(index, { quantity: e.target.value })}
            />
            <Picker
              ariaLabel={`${part.name} unit`}
              value={part.unit}
              text={part.unit}
              options={UNIT_OPTIONS}
              search={false}
              onChange={unit => changePart(index, { unit })}
            />
          </div>

          {share && def?.lines?.length ? (
            <div style={{ border: '1px solid var(--line-soft)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '7px 12px', background: 'var(--panel)', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                {part.quantity} {part.unit} of a {def.yield_quantity} {def.yield_unit} batch · {shareText(share)} of the batch
              </div>
              {def.lines.map((line, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 12px', fontSize: 13, borderTop: '1px solid var(--line-soft)' }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{line.name}</span>
                  <span style={{ fontFamily: MONO, flexShrink: 0 }}>{round(Number(line.quantity) * share)} {line.unit}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {!(Number(def?.yield_quantity) > 0)
                ? 'Set this batch’s finished yield to see what goes on the plate.'
                : !(Number(part.quantity) > 0)
                  ? 'Enter the amount to see the ingredients it uses.'
                  : `Pick a unit that converts to ${def.yield_unit} to see the ingredients it uses.`}
            </div>
          )}

          {!p?.published && (
            <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>
              Confirm this batch prep before you confirm the dish.
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Pulled from your batch recipe. Change the batch once and every dish that uses it updates.
          </div>
        </div>
      </div>
    );
  }

  function partCard(part, index) {
    return (
      <div key={part.name} style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
        <div style={{ padding: '10px 14px', background: 'var(--panel)', borderRadius: '11px 11px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>{part.name}</span>
          <button type="button" onClick={() => removePart(index)} style={{ border: 0, background: 'none', padding: 0, font: "700 12.5px 'Manrope', sans-serif", color: 'var(--accent-deep)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Skip this part
          </button>
        </div>
        <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {part.lines.map((line, lineIndex) => ingredientRow(
            line,
            changes => changeLine(index, lineIndex, changes),
            () => changePart(index, { lines: part.lines.filter((_, j) => j !== lineIndex) }),
            lineIndex
          ))}
          <button type="button" style={{ ...button, alignSelf: 'flex-start' }} onClick={() => changePart(index, { lines: [...part.lines, emptyLine()] })}>
            <Icon d={PLUS} size={13} />
            Ingredient
          </button>
        </div>
      </div>
    );
  }

  const guide = (
    <div style={{ display: 'flex', alignItems: 'center', gap: phone ? 6 : 10, padding: phone ? '10px 12px' : '12px 18px', borderBottom: '1px solid var(--line-soft)' }}>
      {STEPS.flatMap((text, i) => {
        const n = i + 1;
        const done = n < step;
        const on = n === step;
        const item = (
          <span key={text} style={{ display: 'inline-flex', alignItems: 'center', gap: phone ? 5 : 8, fontSize: phone ? 12 : 13, whiteSpace: 'nowrap', fontWeight: on ? 700 : 600, color: on || done ? 'var(--text)' : 'var(--muted)' }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, background: on || done ? 'var(--accent)' : 'var(--shell)', color: on || done ? '#ffffff' : 'var(--faint)', border: `1px solid ${on || done ? 'var(--accent)' : 'var(--line)'}` }}>
              {done ? <Icon d={CHECK} size={11} /> : n}
            </span>
            {text}
          </span>
        );

        return i < STEPS.length - 1
          ? [item, <span key={`${text}-line`} style={{ flex: '1 1 28px', minWidth: 8, maxWidth: 48, height: 1, background: 'var(--line)' }} />]
          : [item];
      })}
    </div>
  );

  let body;

  if (step === 1) {
    body = (
      <>
        <div style={title}>Does anything on this plate come from a batch your kitchen makes ahead?</div>
        <p style={sub}>Sauces, salsa, dressings, mashed potatoes. Enter the whole batch once and every dish that uses it stays in sync.</p>

        {preps.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={kicker}>Your batch preps · tap the ones on this plate</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {preps.map(p => {
                const on = used.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => toggleUsed(p.id)}
                    style={{ ...chip, minHeight: 34, cursor: 'pointer', font: "600 13px 'Manrope', sans-serif", border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--accent-tint)' : 'var(--shell)', color: on ? 'var(--accent-deep)' : 'var(--text)' }}
                  >
                    {on && <Icon d={CHECK} size={13} />}
                    {p.name}{!p.published ? ' · confirm first' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {prep ? (
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={labelStyle}>
              Batch name
              <input style={field} aria-label="Batch name" placeholder="Mashed Potatoes" value={prep.name} onChange={e => editPrep({ name: e.target.value })} />
            </div>
            {prepTaken && (
              <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>
                You already have a batch prep with this name. Tap it above to use it.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
              <div style={labelStyle}>
                Finished yield
                <input style={{ ...field, fontFamily: MONO }} type="number" min="0" step="any" inputMode="decimal" aria-label="Finished yield" value={prep.yield_quantity} onChange={e => editPrep({ yield_quantity: e.target.value })} />
              </div>
              <div style={labelStyle}>
                Unit
                <Picker ariaLabel="Yield unit" value={prep.yield_unit} text={prep.yield_unit} options={UNIT_OPTIONS} search={false} onChange={unit => editPrep({ yield_unit: unit })} />
              </div>
            </div>
            <div style={kicker}>Whole batch</div>
            {prep.lines.map((line, i) => ingredientRow(
              line,
              changes => editPrepLine(i, changes),
              () => editPrep({ lines: prep.lines.filter((_, j) => j !== i) }),
              i
            ))}
            <button type="button" style={{ ...button, alignSelf: 'flex-start' }} onClick={() => editPrep({ lines: [...prep.lines, emptyLine()] })}>
              <Icon d={PLUS} size={13} />
              Ingredient
            </button>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" style={button} disabled={busy} onClick={() => setPrep(null)}>Cancel</button>
              <button type="button" style={primary} disabled={busy || !prepReady} onClick={saveBatch}>
                {busy ? 'Saving…' : 'Save batch'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" style={{ ...button, alignSelf: 'flex-start' }} disabled={busy} onClick={() => setPrep({ name: '', yield_quantity: '', yield_unit: 'lb', lines: [emptyLine()] })}>
            <Icon d={PLUS} size={13} />
            New batch prep
          </button>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" style={primary} disabled={busy || !!prep} onClick={toComponents}>
            {used.length ? 'Next' : 'No batches, next'}
          </button>
        </div>
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <div style={title}>What are the parts of this plate?</div>
        <p style={sub}>List each component, like the protein, the side and the sauce. Type a batch prep’s name to use it.</p>

        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 10, border: '1px solid var(--line)', borderRadius: 12 }}>
            {parts.map((part, i) => (
              <span key={part.name} style={{ ...chip, background: part.prep_id ? 'var(--accent-tint)' : 'var(--panel)', color: part.prep_id ? 'var(--accent-deep)' : 'var(--text)' }}>
                {part.prep_id ? `${part.name} · batch` : part.name}
                <button type="button" aria-label={`Remove ${part.name}`} onClick={() => removePart(i)} style={{ border: 0, background: 'none', padding: 0, display: 'flex', color: 'inherit', cursor: 'pointer' }}>
                  <Icon d={X} size={12} />
                </button>
              </span>
            ))}
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addPart(typed);
                }
              }}
              placeholder={parts.length ? 'Add another part' : 'Meatloaf, mashed potatoes, gravy…'}
              aria-label="Add a component"
              style={{ flex: '1 1 160px', minWidth: 0, minHeight: 32, border: 0, outline: 'none', background: 'transparent', color: 'var(--text)', font: "500 14px 'Manrope', sans-serif" }}
            />
          </div>

          {typed.trim() && (
            <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 30, width: 'min(360px, 100%)', background: 'var(--shell)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 18px 40px rgba(17,24,25,0.14)', overflow: 'hidden' }}>
              {suggestions.map(p => (
                <button key={p.id} type="button" onClick={() => addPart(p.name)} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', padding: '10px 12px', border: 0, background: 'transparent', color: 'var(--text)', font: "500 13.5px 'Manrope', sans-serif", textAlign: 'left', cursor: 'pointer' }}>
                  <span>{p.name}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--accent-deep)' }}>BATCH</span>
                </button>
              ))}
              {!prepNamed(typed) && (
                <button type="button" onClick={() => addPart(typed)} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', padding: '10px 12px', border: 0, borderTop: suggestions.length ? '1px solid var(--line-soft)' : 0, background: 'var(--accent-tint)', color: 'var(--text)', font: "600 13.5px 'Manrope', sans-serif", textAlign: 'left', cursor: 'pointer' }}>
                  <span>Add “{typed.trim()}” as a component</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>ENTER</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button type="button" style={button} disabled={busy} onClick={() => setStep(1)}>Back</button>
          <button
            type="button"
            style={primary}
            disabled={busy || (!parts.length && !typed.trim())}
            onClick={() => {
              if (typed.trim()) addPart(typed);
              setStep(3);
            }}
          >
            OK, next
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div style={title}>Now the recipe for each part, for one plate</div>
        {parts.map((part, i) => (part.prep_id ? batchCard(part, i) : partCard(part, i)))}
        {!parts.length && <p style={sub}>Every part was skipped. Go back and add at least one.</p>}

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
          <button type="button" style={button} disabled={busy} onClick={() => setStep(2)}>Back</button>
          <div style={{ display: 'flex', gap: 8, flex: phone ? '1 1 100%' : '0 0 auto' }}>
            <button type="button" style={{ ...button, flex: phone ? 1 : '0 0 auto' }} disabled={busy || !lines.length} onClick={() => onSave(lines, false)}>
              Save draft
            </button>
            <button type="button" style={{ ...primary, flex: phone ? 1.4 : '0 0 auto' }} disabled={busy || !lines.length} onClick={() => onSave(lines, true)}>
              Confirm recipe
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--shell)', minWidth: 0, boxShadow: '0 1px 1px rgba(17,24,25,0.05), 0 3px 6px rgba(17,24,25,0.07)' }}>
      <div style={{ padding: phone ? '14px 16px 10px' : '16px 18px 12px', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={kicker}>
            Build from blank{dish.menu_section || dish.section ? ` · ${dish.menu_section || dish.section}` : ''}
          </div>
          <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', overflowWrap: 'anywhere' }}>
            {dish.name}
          </h2>
        </div>
        {!phone && (
          <button type="button" aria-label="Close" disabled={busy} onClick={onClose} style={{ width: 36, height: 36, flexShrink: 0, border: '1px solid var(--line)', borderRadius: '50%', background: 'transparent', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Icon d={X} size={15} />
          </button>
        )}
      </div>
      {guide}
      <div style={{ padding: phone ? 14 : '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {body}
      </div>
    </section>
  );
}