import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminShell, { PageHead, Dialog } from '../../components/admin/AdminShell';
import { MONO } from '../../components/client/ClientChrome';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import useIsPhone from '../../lib/admin/useIsPhone';
import Picker from '../../components/client/Picker';
import { transferPlan } from '../../lib/pos/transferPlan';

const UNITS = [
  'each', 'slice', 'bunch', 'package',
  'oz', 'lb', 'g', 'kg',
  'fl oz', 'cup', 'pt', 'qt', 'gal',
  'ml', 'l', 'tsp', 'tbsp',
];

const TONES = {
  READY: ['var(--green-tint)', 'var(--green)'],
  ESTIMATED: ['var(--amber-tint)', 'var(--amber)'],
  'NEEDS REVIEW': ['var(--red-tint)', 'var(--red)'],
  EXCLUDED: ['var(--panel)', 'var(--muted)'],
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function shortDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}` : String(value || '—');
}

function formatQty(value) {
  return Number.isFinite(value)
    ? Number(value.toFixed(4)).toLocaleString('en-US', {
        maximumFractionDigits: 4,
      })
    : '—';
}

function rowStatus(row) {
  if (row.status === 'blocked') return 'NEEDS REVIEW';
  if (row.status === 'excluded') return 'EXCLUDED';
  return row.estimated ? 'ESTIMATED' : 'READY';
}


const REVIEW_MARKS = {
  dish: ['Which dish is this?', 'var(--red-tint)', 'var(--red)'],
  amount: ['Check this amount', 'var(--amber-tint)', 'var(--amber)'],
  weight: ['Missing a weight', 'var(--accent-tint)', 'var(--accent-deep)'],
  untracked: ['Can\u2019t count one item', 'color-mix(in srgb, #6b3a8c 14%, var(--shell))', '#6b3a8c'],
  retry: ['Working on it', 'var(--panel)', 'var(--muted)'],
  new: ['New on the POS', 'var(--green-tint)', 'var(--green)'],
};

// Why a dish needs review, or null when it counts on its own.
// Removals and plain dishes never ask; extras and swaps ask once.
function reviewKind(row) {
  if (row.status === 'excluded') return null;

  if (row.status === 'blocked') {
    if (row.review) return row.review;
    if (row.retryable) return 'retry';
    return /matching OptiMenu dish|dish mapping/i.test(row.reason || '')
      ? 'dish'
      : 'amount';
  }

  if (row.origin === 'admin') return null;
  if (row.plan?.untracked?.length) return 'untracked';

  const guessed = (row.plan?.operations || []).some((op) => op.action !== 'remove');

  return guessed ? 'amount' : null;
}

function requestList(row) {
  const modifiers = row.instructions?.modifiers || [];
  return [
    ...modifiers.map((modifier) => modifier.name),
    ...(row.instructions?.requests || []),
    ...modifiers.flatMap((modifier) => modifier.requests || []),
  ].filter((value) => value && String(value).trim());
}

// Same requests regardless of dish, ignoring a modifier group prefix.
function requestSignature(row) {
  return requestList(row)
    .map((value) => String(value).split(':').pop().trim().toLowerCase())
    .sort()
    .join('|');
}

// What the plan did, in recipe units, one sentence per change.
function planLines(row, ingredients) {
  const name = (id) =>
    ingredients.find((ingredient) => ingredient.id === id)?.name || 'Unknown ingredient';
  const base = row.base || [];

  return (row.plan?.operations || []).map((op) => {
    if (op.action === 'remove') {
      return base.some((part) => part.id === op.ingredient_id)
        ? `Removed ${name(op.ingredient_id)}`
        : null;
    }

    if (op.action === 'replace') {
      const amount = ['equal_weight', 'equal_volume'].includes(op.basis)
        ? 'the same amount'
        : `${formatQty(op.quantity)} ${op.unit || ''}`.trim();
      return `Swapped ${name(op.ingredient_id)} for ${amount} of ${name(op.target_id)}`;
    }

    const had = base.some((part) => part.id === op.ingredient_id);
    return `${had ? 'Set' : 'Added'} ${formatQty(op.quantity)} ${op.unit || ''} of ${name(op.ingredient_id)}`
      .replace(/\s+/g, ' ');
  }).filter(Boolean);
}

function longDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return String(value || '—');
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const menuWords = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ')
  .split(/\s+/)
  .filter((word) => word.length > 2);

// Up to three menu dishes sharing the most words with the POS name.
function closestMenus(name, menus) {
  const words = new Set(menuWords(name));
  return menus
    .map((menu) => ({
      menu,
      score: menuWords(menu.name).filter((word) => words.has(word)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.menu.name.localeCompare(b.menu.name))
    .slice(0, 3)
    .map((entry) => entry.menu);
}

const GUESSED = ['estimated', 'equal_weight', 'equal_volume'];

// One recipe view: every line of the dish by part of the plate, marked
// unchanged, removed, added or adjusted by the requests on the ticket.
function dishView(row, ingredients) {
  const nameOf = (id) =>
    ingredients.find((ingredient) => ingredient.id === id)?.name || 'Ingredient';
  const removedParts = new Set(row.removed_components || []);
  const requests = requestList(row);
  const plan = row.status === 'ready' ? row.plan : null;
  const sections = [];
  const lines = [];

  const sectionFor = (key, title, tone, why) => {
    let section = sections.find((value) => value.key === key);
    if (!section) {
      section = { key, title, tone, why, lines: [] };
      sections.push(section);
    }
    return section;
  };

  // Which request took a part of the plate off, such as No Gravy.
  const removedBy = (partName) => {
    const have = menuWords(partName).map((word) => word.replace(/s$/, ''));
    return requests.find((text) => {
      const match = /\b(?:no|without|hold)\b\s*:?\s*(.+)$/i.exec(String(text));
      const words = match ? menuWords(match[1]).map((word) => word.replace(/s$/, '')) : [];
      return words.length && words.every((word) => have.includes(word));
    });
  };

  for (const part of row.base || []) {
    const pieces = part.components?.length
      ? part.components
      : [{ name: 'Recipe', quantity: part.quantity }];

    for (const piece of pieces) {
      const partName = piece.name || 'Recipe';
      const gone = removedParts.has(partName);
      const by = gone ? removedBy(partName) : null;
      const section = sectionFor(
        `part:${partName}`,
        partName,
        gone ? 'removed' : null,
        gone ? `Removed · ${by || 'by request'}` : ''
      );
      const line = {
        key: `part:${partName}:${part.id}:${section.lines.length}`,
        id: part.id,
        name: part.name,
        part: partName,
        qty: Number(piece.quantity),
        unit: part.unit,
        recipe: `${formatQty(Number(piece.quantity))} ${part.unit || ''}`.trim(),
        state: gone ? 'removed' : 'same',
      };

      section.lines.push(line);
      lines.push(line);
    }
  }

  const kept = (id) => lines.filter((line) => line.id === id && line.state !== 'removed');
  const total = (list) => list.reduce((sum, line) => sum + line.qty, 0);

  const add = (op, id, qty, unit, extra = {}) => {
    const title = op.part || 'Added by request';
    const section = sectionFor(`add:${title}`, title, 'added', 'Added');
    section.lines.push({
      key: `add:${title}:${id}:${section.lines.length}`,
      id,
      name: nameOf(id),
      part: title,
      qty: Number(qty),
      unit,
      recipe: null,
      state: 'added',
      guessed: GUESSED.includes(op.basis),
      ...extra,
    });
  };

  const adjust = (mine, qty, unit) => {
    const sameUnit = mine.every((line) => line.unit === unit);
    if (sameUnit && Math.abs(total(mine) - qty) < 1e-9) return;

    mine[0].was = `${formatQty(total(mine))} ${mine[0].unit || ''}`.trim();
    mine[0].state = 'adjusted';
    mine[0].qty = Number(qty);
    mine[0].unit = unit;
    mine.slice(1).forEach((line) => { line.state = 'merged'; });
  };

  if (plan?.replace_all) {
    const sets = new Map(
      (plan.operations || [])
        .filter((op) => op.action === 'set')
        .map((op) => [op.ingredient_id, op])
    );

    for (const id of new Set(lines.map((line) => line.id))) {
      const mine = kept(id);
      if (!mine.length) continue;

      const set = sets.get(id);
      sets.delete(id);

      if (!set) mine.forEach((line) => { line.state = 'removed'; });
      else adjust(mine, set.quantity, set.unit);
    }

    for (const [id, set] of sets) {
      add({ part: 'Added by you' }, id, set.quantity, set.unit);
    }
  } else {
    for (const op of plan?.operations || []) {
      const mine = kept(op.ingredient_id);

      if (op.action === 'remove') {
        mine.forEach((line) => { line.state = 'removed'; });
      } else if (op.action === 'replace') {
        const same = ['equal_weight', 'equal_volume'].includes(op.basis);
        const amount = total(mine);
        mine.forEach((line) => { line.state = 'removed'; });
        add(
          op,
          op.target_id,
          same ? amount : op.quantity,
          same ? mine[0]?.unit : op.unit,
          { instead: nameOf(op.ingredient_id) }
        );
      } else if (mine.length) {
        adjust(mine, op.quantity, op.unit);
      } else {
        add(op, op.ingredient_id, op.quantity, op.unit);
      }
    }
  }

  // A part of the plate shows as removed when every line in it is.
  for (const section of sections) {
    if (
      !section.tone &&
      section.lines.length &&
      section.lines.every((line) => line.state === 'removed')
    ) {
      section.tone = 'removed';
      section.why = 'Removed · by request';
    }
  }

  return { sections, lines: sections.flatMap((section) => section.lines) };
}

function amountText(line) {
  const amount = Number.isFinite(line.qty)
    ? `${formatQty(line.qty)} ${line.unit || ''}`.trim()
    : 'same amount';

  if (line.state === 'added') return `+${amount}`;
  if (line.state === 'adjusted') return `${line.was} → ${amount}`;
  if (line.state === 'merged') return 'in the total above';
  return amount;
}

// Base recipe next to this order's adjusted recipe, one line per ingredient.
function ingredientRows(row) {
  const base = row.base || [];
  const ids = [...new Set(
    [...base, ...(row.adjusted || [])].map((part) => part.id)
  )];
  const touched = new Set(
    (row.plan?.operations || [])
      .flatMap((op) => [op.ingredient_id, op.target_id])
      .filter(Boolean)
  );

  return ids.map((id) => {
    const originals = base.filter((part) => part.id === id);
    const adjusted = row.adjusted?.find((part) => part.id === id);
    const first = adjusted || originals[0];
    const sameUnit = originals.every((part) => part.unit === first.unit);

    const before = originals.length && sameUnit
      ? originals.reduce((sum, part) => sum + Number(part.quantity || 0), 0)
      : null;

    const quantity = adjusted
      ? adjusted.quantity
      : row.adjusted ? 0 : before;

    return {
      ...first,
      before,
      before_label: originals.length
        ? originals.map((part) =>
            `${formatQty(part.quantity)} ${part.unit || ''}`.trim()
          ).join(' + ')
        : '—',
      quantity,
      added: !originals.length,
      // Only ingredients the plan changed; a unit conversion alone is not a change.
      changed: Boolean(
        row.adjusted && (
          !originals.length ||
          !adjusted ||
          (row.plan?.replace_all
            ? sameUnit &&
              originals[0].unit === adjusted.unit &&
              Math.abs(adjusted.quantity - before) > 1e-9
            : touched.has(id))
        )
      ),
    };
  });
}

function changeText(part) {
  if (part.quantity === 0) return 'Removed';
  if (part.added) return `Added ${formatQty(part.quantity)} ${part.unit || ''}`.trim();
  return `${formatQty(part.quantity)} ${part.unit || ''}`.trim();
}

function Tag({ status }) {
  const [bg, fg] = TONES[status];
  return (
    <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', borderRadius: 5, padding: '3px 7px', whiteSpace: 'nowrap', background: bg, color: fg }}>
      {status}
    </span>
  );
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div className="pu-seg" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Kicker({ children, style }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)', ...style }}>
      {children}
    </div>
  );
}

export default function PosUsage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const isPhone = useIsPhone();

  const restaurantId = typeof router.query.restaurant === 'string'
    ? router.query.restaurant
    : '';

  const [restaurants, setRestaurants] = useState([]);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [startDate, setStartDate] = useState('2026-10-24');
  const [editing, setEditing] = useState(null);
  const [portions, setPortions] = useState([]);
  const [addId, setAddId] = useState('');
  const [view, setView] = useState('review');
  const [reviewDay, setReviewDay] = useState('all');
  const [doneDay, setDoneDay] = useState('');
  const [openKey, setOpenKey] = useState('');
  const [match, setMatch] = useState({});
  const [offer, setOffer] = useState(null);
  const [creating, setCreating] = useState(null);
  const [noting, setNoting] = useState(null);
  const [lineEdit, setLineEdit] = useState(null);
  const [unitsKey, setUnitsKey] = useState('');

  const report = data?.result?.report || [];
  const sorted = [...report].sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || '')) ||
    String(a.ticket ?? '').localeCompare(String(b.ticket ?? ''), undefined, { numeric: true }) ||
    String(a.line_key || '').localeCompare(String(b.line_key || '')) ||
    (a.unit_index || 0) - (b.unit_index || 0)
  );

  // Needs review: one group per dish with the same requests, oldest first.
  const reviewGroups = [];
  const groupIndex = new Map();

  for (const row of sorted) {
    const kind = reviewKind(row);
    if (!kind) continue;

    const key = row.context_key
      ? `${kind}:${row.context_key}`
      : `${kind}:${row.item_ref}:${row.dish}:${row.reason || ''}`;

    if (!groupIndex.has(key)) {
      const group = { key, kind, row, sales: [] };
      groupIndex.set(key, group);
      reviewGroups.push(group);
    }

    groupIndex.get(key).sales.push(row);
  }

  // POS buttons with no dish that have not sold yet, oldest first.
  for (const button of [...(data?.newButtons || [])].sort((a, b) =>
    String(a.first_seen_at || '').localeCompare(String(b.first_seen_at || ''))
  )) {
    reviewGroups.push({
      key: `new:${button.external_id}`,
      kind: 'new',
      button,
      row: { dish: button.name, item_ref: button.external_id },
      sales: [],
    });
  }

  const days = [...new Set(sorted.map((row) => row.date).filter(Boolean))];
  const visibleGroups = reviewDay === 'all'
    ? reviewGroups
    : reviewGroups.filter((group) =>
        group.sales.some((sale) => sale.date === reviewDay)
      );

  // Done: every counted dish on one day, one line per ticket line.
  const shownDay = days.includes(doneDay) ? doneDay : days[days.length - 1] || '';
  const dayIndex = days.indexOf(shownDay);
  const doneLines = [];
  const lineIndex = new Map();

  for (const row of sorted) {
    if (row.date !== shownDay || reviewKind(row)) continue;

    if (!lineIndex.has(row.line_key)) {
      const line = { row, count: 0 };
      lineIndex.set(row.line_key, line);
      doneLines.push(line);
    }

    lineIndex.get(row.line_key).count++;
  }

  const waitingToday = new Set(
    sorted
      .filter((row) => row.date === shownDay && reviewKind(row))
      .map((row) => row.line_key)
  ).size;

  const typedMissing = report.some((row) =>
    row.instructions && row.typed_requests_available === false
  );
  const applied = Boolean(
    data?.settings?.enabled &&
    data?.result?.publication_id &&
    data?.job?.applied_publication_id === data.result.publication_id
  );

  function setQuery(changes, replace = false) {
    const query = { ...router.query, ...changes };
    Object.keys(query).forEach((key) => {
      if (!query[key]) delete query[key];
    });
    router[replace ? 'replace' : 'push'](
      { pathname: router.pathname, query },
      undefined,
      { shallow: true, scroll: false }
    );
  }

  async function request(url, body) {
    const response = await adminFetch(
      url,
      body
        ? {
            method: 'POST',
            body: JSON.stringify(body),
          }
        : {}
    );

    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.error || 'Request failed');
    }

    return json;
  }

  useEffect(() => {
    let live = true;

    request('/api/admin/pos-usage')
      .then((json) => {
        if (live) setRestaurants(json.restaurants);
      })
      .catch((error) => {
        if (live) setMessage(error.message);
      });

    return () => { live = false; };
  }, [adminFetch]);

  useEffect(() => {
    let live = true;

    setData(null);
    setEditing(null);
    setMessage('');
    setOpenKey('');
    setMatch({});
    setReviewDay('all');
    setDoneDay('');

    let timer;

    const refresh = async () => {
      try {
        const json = await request(
          `/api/admin/pos-usage?restaurantId=${restaurantId}`
        );

        if (live) setData(json);
      } catch (error) {
        if (live) setMessage(error.message);
      } finally {
        if (live) timer = setTimeout(refresh, 15000);
      }
    };

    if (restaurantId) refresh();

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [restaurantId, adminFetch]);

  async function act(action, extra = {}) {
    setBusy(true);
    setMessage('');

    let result = null;

    try {
      result = await request('/api/admin/pos-usage', {
        restaurantId,
        action,
        ...extra,
      });

      setData(await request(
        `/api/admin/pos-usage?restaurantId=${restaurantId}`
      ));

      setMessage(
        action === 'disable'
          ? 'Standard recipes restored.'
          : result.usage?.error
            ? `Saved, but usage processing failed: ${result.usage.error}. The daily inventory job will retry it; you can also use Retry now.`
            : result.usage?.retryPending
              ? 'Saved. Some interpretations still need a retry. Successful servings have been processed.'
              : result.usage?.applied
                ? 'Saved. Prepared servings have been applied to inventory.'
                : result.usage?.skipped
                  ? 'Saved. Usage is already current or another run is processing it.'
                  : 'Saved. Preview updated.'
      );

      setEditing(null);
    } catch (error) {
      setMessage(error.message);
      result = null;
    } finally {
      setBusy(false);
    }

    return result;
  }

  function edit(row) {
    // Start from what was counted, or from the recipe with any parts the
    // customer left off (No Gravy) already taken out.
    const recipe = row.counted_base || row.base || [];
    const parts = row.adjusted || recipe;
    const totals = new Map();

    // Which parts of the plate each ingredient comes from.
    const from = new Map();

    for (const part of recipe) {
      const names = from.get(part.id) || new Set();
      for (const component of part.components || []) {
        if (component.name) names.add(component.name);
      }
      from.set(part.id, names);
    }

    // Each line keeps the unit it was counted in (0.1094 qt of milk);
    // usage converts it to the inventory unit.
    for (const part of parts) {
      if (!data.ingredients.some((candidate) => candidate.id === part.id)) continue;

      const old = totals.get(part.id);
      const quantity = Number(part.quantity);

      if (!old) {
        totals.set(part.id, {
          id: part.id,
          unit: part.unit,
          from: [...(from.get(part.id) || [])],
          quantity: Number.isFinite(quantity) ? String(Number(quantity.toFixed(4))) : '',
        });
      } else if (old.unit === part.unit && old.quantity !== '' && Number.isFinite(quantity)) {
        old.quantity = String(Number((Number(old.quantity) + quantity).toFixed(4)));
      } else {
        old.quantity = '';
      }
    }

    // Grouped by part of the plate, in recipe order.
    setPortions([...totals.values()].sort((a, b) =>
      String(a.from[0] || '').localeCompare(String(b.from[0] || ''))
    ));
    setEditing(row);
    setAddId('');
  }

  // The ingredient a Missing a weight reason names (longest name wins).
  const weightIngredient = (row) => (data?.ingredients || [])
    .filter((ingredient) => String(row.reason || '').includes(ingredient.name))
    .sort((a, b) => b.name.length - a.name.length)[0];

  // After an answer is saved, offer it to other dishes in review
  // that sold with exactly the same request.
  function offerOthers(sourceRow, plan) {
    if (!plan) return;

    const signature = requestSignature(sourceRow);
    if (!signature) return;

    const candidates = reviewGroups
      .filter((group) =>
        group.row.context_key &&
        group.row.context_key !== sourceRow.context_key &&
        group.row.rule_available &&
        ['amount', 'untracked'].includes(group.kind) &&
        requestSignature(group.row) === signature
      )
      .flatMap((group) => {
        const moved = transferPlan(plan, sourceRow.base || [], group.row.base || []);
        return moved
          ? [{
              contextKey: group.row.context_key,
              dish: group.row.dish,
              sales: group.sales.length,
              lines: planLines({ ...group.row, plan: moved }, data.ingredients),
            }]
          : [];
      });

    if (candidates.length) {
      setOffer({
        sourceKey: sourceRow.context_key,
        dish: sourceRow.dish,
        request: requestList(sourceRow).join(' · '),
        candidates,
        checked: [],
      });
    }
  }

  // Click a line in the recipe view.
  function openLine(row, line) {
    setMessage('');
    setLineEdit({
      row,
      line,
      part: line.part,
      ingredientId: line.id,
      name: line.name,
      qty: Number.isFinite(line.qty) ? String(Number(line.qty.toFixed(4))) : '',
      unit: line.unit || '',
    });
  }

  function openAdd(row) {
    setMessage('');
    setLineEdit({
      row,
      line: null,
      part: 'Added by you',
      ingredientId: '',
      name: '',
      qty: '',
      unit: '',
    });
  }

  // Saves the whole dish as your answer, with one line changed, removed or
  // added. change: { line, remove, id, qty, unit }, or null to save as shown.
  async function saveDish(row, change) {
    const view = dishView(row, data.ingredients);
    const totals = new Map();
    const nameOf = (id) =>
      data.ingredients.find((ingredient) => ingredient.id === id)?.name || 'An ingredient';

    const push = (id, quantity, unit) => {
      if (!Number.isFinite(quantity)) {
        throw new Error(`${nameOf(id)} has no amount yet. Click it and enter one first.`);
      }

      const old = totals.get(id);

      if (!old) totals.set(id, { id, quantity, unit });
      else if (old.unit === unit) old.quantity += quantity;
      else throw new Error(`${nameOf(id)} is in two different units here. Put both lines in the same unit.`);
    };

    try {
      for (const line of view.lines) {
        if (line.state === 'removed' || line.state === 'merged') continue;
        if (change?.line && line.key === change.line.key) continue;
        push(line.id, line.qty, line.unit);
      }

      if (change && !change.remove) {
        push(change.id, Number(change.qty), change.unit);
      }
    } catch (error) {
      setMessage(error.message);
      return null;
    }

    const result = await act('rule', {
      contextKey: row.context_key,
      portions: [...totals.values()].map((portion) => ({
        ...portion,
        quantity: Number(portion.quantity.toFixed(4)),
      })),
    });

    if (result) offerOthers(row, result.plan);

    return result;
  }

  // Add as a new dish, for a POS button with no matching dish.
  function openNewDish(row, button) {
    setMessage('');
    setCreating({
      itemRef: row.item_ref,
      button: row.dish,
      name: row.dish,
      price: button?.price ?? null,
      category: button?.category_name || '',
      lines: [],
      notes: '',
    });
  }

  async function draftRecipe() {
    setBusy(true);
    setMessage('');

    try {
      const result = await request('/api/admin/pos-usage', {
        restaurantId,
        action: 'draft-dish',
        name: creating.name,
        category: creating.category,
      });

      setCreating((old) => old && {
        ...old,
        lines: result.lines || [],
        notes: result.notes || '',
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function setLine(index, changes) {
    setCreating((old) => old && {
      ...old,
      lines: old.lines.map((line, i) => (i === index ? { ...line, ...changes } : line)),
    });
  }

  // A picked ingredient or batch prep for a recipe line.
  function pickLine(id, line) {
    if (id.startsWith('prep:')) {
      const prep = (data?.preps || []).find((value) => `prep:${value.id}` === id);
      return {
        ...line,
        prep_id: prep?.id || null,
        ingredient_id: null,
        name: prep?.name || line.name,
        unit: line.unit || prep?.yield_unit || '',
      };
    }

    const ingredient = data.ingredients.find((value) => value.id === id);
    return {
      ...line,
      ingredient_id: ingredient?.id || null,
      prep_id: null,
      name: ingredient?.name || line.name,
      unit: line.unit || ingredient?.unit || '',
    };
  }

  const selectRestaurant = (
    <select
      aria-label="Restaurant"
      className="om-field"
      value={restaurantId}
      disabled={busy}
      style={{ width: isPhone ? '100%' : 240, minHeight: isPhone ? 44 : 38, borderRadius: isPhone ? 10 : 20 }}
      onChange={(event) => setQuery({ restaurant: event.target.value }, true)}
    >
      <option value="">Choose restaurant</option>
      {restaurants.map((restaurant) => (
        <option key={restaurant.id} value={restaurant.id}>
          {restaurant.name || 'Unnamed restaurant'}
        </option>
      ))}
    </select>
  );

  const actions = data?.settings ? (
    <>
      <button type="button" className="om-btn" disabled={busy} onClick={() => act('prepare')}>
        {busy ? 'Working…' : 'Retry now'}
      </button>
      {data.settings.enabled ? (
        <button type="button" className="om-btn" disabled={busy} onClick={() => act('disable')}>
          {isPhone ? 'Standard recipes' : 'Return to standard recipes'}
        </button>
      ) : (
        <button type="button" className="om-pri" disabled={busy} onClick={() => act('enable')}>
          Use for inventory
        </button>
      )}
    </>
  ) : null;

  function renderDish(row, index) {
    const status = rowStatus(row);
    const ingredients = ingredientRows(row);
    const changes = ingredients.filter((part) => part.changed);
    const modifiers = row.instructions?.modifiers || [];
    const requests = [
      ...(row.instructions?.requests || []),
      ...modifiers.flatMap((modifier) => modifier.requests || []),
    ].filter((text) => text && text.trim());
    const indent = isPhone ? 0 : 40;
    const servingLabel = Number(row.quantity) > 1 && row.unit_index
      ? `serving ${row.unit_index} of ${row.quantity}`
      : Number(row.quantity) > 1 ? `×${row.quantity}` : '×1';
    const reasonBg = status === 'ESTIMATED' ? 'var(--amber-tint)' : 'var(--red-tint)';
    const reason = row.reason || '';
    // The recipe by part of the plate, as written (recipe units).
    const removedParts = new Set(row.removed_components || []);
    const groups = [];

    for (const part of row.base || []) {
      const pieces = part.components?.length
        ? part.components
        : [{ name: 'Recipe', quantity: part.quantity }];

      for (const piece of pieces) {
        const name = piece.name || 'Recipe';
        let group = groups.find((value) => value.name === name);

        if (!group) {
          group = { name, lines: [] };
          groups.push(group);
        }

        group.lines.push({ name: part.name, quantity: Number(piece.quantity), unit: part.unit });
      }
    }

    const headStyle = { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 12px', background: 'var(--panel)', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--muted)' };
    const lineStyle = { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 12px', borderTop: '1px solid var(--line-soft)', fontSize: 13 };

    const recipeTable = (
      <div style={{ border: '1px solid var(--line-soft)', borderRadius: 8, overflow: 'hidden' }}>
        {groups.map((group, index) => {
          const gone = removedParts.has(group.name);
          return (
            <div key={group.name} style={{ borderTop: index ? '1px solid var(--line)' : 0 }}>
              <div style={headStyle}>
                <span>{group.name.toUpperCase()}</span>
                {gone && <span style={{ color: 'var(--red)' }}>REMOVED BY REQUEST</span>}
              </div>
              {group.lines.map((line, i) => (
                <div key={i} style={{ ...lineStyle, color: gone ? 'var(--muted)' : 'var(--text)', textDecoration: gone ? 'line-through' : 'none' }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{line.name}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12, whiteSpace: 'nowrap' }}>
                    {Number.isFinite(line.quantity) ? formatQty(line.quantity) : '—'} {line.unit || ''}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );

    // What was actually taken out of inventory for this order.
    const countedTable = row.adjusted?.length ? (
      <div style={{ border: '1px solid var(--line-soft)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={headStyle}><span>COUNTED FOR THIS ORDER · INVENTORY UNITS</span></div>
        {row.adjusted.map((part) => (
          <div key={part.id} style={lineStyle}>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{part.name}</span>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {formatQty(part.quantity)} {part.unit || ''}
            </span>
          </div>
        ))}
      </div>
    ) : null;

    return (
      <article style={{ border: '1px solid var(--line)', borderRadius: 10, padding: isPhone ? 14 : '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--shell)', minWidth: 0, overflowWrap: 'anywhere' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {!isPhone && (
            <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
              {String(index + 1).padStart(2, '0')}
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em' }}>
                {row.dish}{' '}
                <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 500, color: 'var(--muted)' }}>{servingLabel}</span>
              </h3>
              <Tag status={status} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {modifiers.map((modifier, i) => (
                <span key={`m${i}`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '0 9px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: 'var(--accent-tint)', color: 'var(--accent-deep)' }}>
                  {modifier.name}
                </span>
              ))}
              {requests.map((text, i) => (
                <span key={`r${i}`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '0 9px', borderRadius: 12, fontSize: 12, fontWeight: 600, border: '1px solid var(--amber)', color: 'var(--amber)' }}>
                  TYPED · {text}
                </span>
              ))}
              {!modifiers.length && !requests.length && (
                <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '0 9px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: 'var(--panel)', color: 'var(--muted)' }}>
                  Standard order
                </span>
              )}
            </div>
          </div>
        </div>

        {status === 'READY' && !changes.length && (
          <div style={{ paddingLeft: indent, paddingTop: 8, borderTop: '1px solid var(--line-soft)', fontSize: 13, color: 'var(--muted)' }}>
            Standard recipe · {ingredients.length} {ingredients.length === 1 ? 'ingredient' : 'ingredients'}
          </div>
        )}

        {status === 'EXCLUDED' && (
          <div style={{ paddingLeft: indent, paddingTop: 8, borderTop: '1px solid var(--line-soft)', fontSize: 13, color: 'var(--muted)' }}>
            {row.reason || 'No tracked food · skipped'}
          </div>
        )}

        {row.status === 'ready' && changes.length > 0 && (
          <div style={{ paddingLeft: indent, paddingTop: 10, borderTop: '1px solid var(--line-soft)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {changes.map((part) => (
              <div key={part.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, fontSize: 13.5 }}>
                <strong style={{ fontWeight: 700 }}>{part.name}</strong>
                {!part.added && part.quantity !== 0 && (
                  <>
                    <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>{part.before_label}</span>
                    <span aria-hidden="true" style={{ color: 'var(--faint)' }}>→</span>
                  </>
                )}
                <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: part.quantity === 0 ? 'var(--red)' : status === 'ESTIMATED' ? 'var(--amber)' : 'var(--accent-deep)' }}>
                  {changeText(part)}
                </span>
              </div>
            ))}
          </div>
        )}

        {row.status === 'blocked' && groups.length > 0 && (
          <div style={{ marginLeft: indent }}>{recipeTable}</div>
        )}

        {status !== 'EXCLUDED' && reason && (
          <div style={{ marginLeft: indent, background: reasonBg, borderRadius: 8, padding: '10px 12px', fontSize: 13, lineHeight: 1.55 }}>
            {reason}
          </div>
        )}

        {row.reason === 'Choose the matching OptiMenu dish' && (
          <div style={{ marginLeft: indent, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              aria-label={`Match recipe for ${row.dish}`}
              className="om-field"
              style={{ flex: '1 1 200px', width: 'auto', minWidth: 0 }}
              disabled={busy}
              defaultValue=""
              onChange={(event) =>
                event.target.value && act('map', {
                  itemRef: row.item_ref,
                  menuId: event.target.value,
                })
              }
            >
              <option value="">Choose the matching dish</option>
              {data.menus.map((menu) => (
                <option key={menu.id} value={menu.id}>{menu.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="om-btn"
              disabled={busy}
              onClick={() => act('map', { itemRef: row.item_ref, menuId: '__exclude__' })}
            >
              Not food · exclude
            </button>
          </div>
        )}

        {row.rule_available && row.status === 'blocked' && (
          <div style={{ marginLeft: indent, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="om-pri"
              disabled={busy}
              onClick={() => edit(row)}
            >
              {row.status === 'blocked' ? 'Set portions' : 'Confirm or change portion'}
            </button>
          </div>
        )}

        {row.status === 'ready' && (ingredients.length > 0 || row.plan?.explanation) && (
          <details style={{ marginLeft: indent }}>
            <summary style={{ cursor: 'pointer', color: 'var(--accent-deep)', fontSize: 12.5, fontWeight: 700, padding: '4px 0' }}>
              Ingredients &amp; calculation
            </summary>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groups.length > 0 && recipeTable}
              {countedTable}
              {row.plan?.explanation && (
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6 }}>{row.plan.explanation}</p>
              )}
              {row.instructions && (
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)' }}>
                  {row.typed_requests_available
                    ? 'Typed requests were read for this dish.'
                    : 'Typed requests were not available for this dish.'}
                </p>
              )}
              {row.rule_available && (
                <button
                  type="button"
                  className="om-btn"
                  style={{ alignSelf: 'flex-start' }}
                  disabled={busy}
                  onClick={() => edit(row)}
                >
                  Edit portions
                </button>
              )}
            </div>
          </details>
        )}
      </article>
    );
  }

  // The dish as one recipe: each part of the plate, colored by what the
  // requests did. Click a line to change it; + adds an ingredient.
  function renderRecipe(row, note) {
    const view = dishView(row, data.ingredients);
    const key = `${row.line_key}:${row.unit_index || 0}`;
    const unitsOpen = unitsKey === key;
    const editable = Boolean(row.context_key && row.rule_available);

    return (
      <div className="pu-view">
        <div className="pu-recipe">
          {view.sections.map((section) => (
            <div key={section.key}>
              <div className="pu-part">
                <span>{section.title.toUpperCase()}</span>
                {section.why && <span className="pu-why" data-tone={section.tone || undefined}>{section.why}</span>}
              </div>
              {section.lines.map((line) => (
                <button
                  key={line.key}
                  type="button"
                  className="pu-line-row"
                  data-state={line.state}
                  disabled={busy || !editable || line.state === 'merged'}
                  onClick={() => openLine(row, line)}
                >
                  <span>
                    {line.name}
                    {line.instead && <em>instead of {line.instead}</em>}
                    {line.guessed && <span className="pu-guess">guessed</span>}
                  </span>
                  <span className="pu-amt">{amountText(line)}</span>
                </button>
              ))}
            </div>
          ))}
          {editable && (
            <button type="button" className="pu-line-row pu-add-row" disabled={busy} onClick={() => openAdd(row)}>
              <span>+ Add an ingredient</span>
              <span />
            </button>
          )}
        </div>

        {note && <p className="pu-note">{note}</p>}

        {row.adjusted?.length > 0 && (
          <>
            <button type="button" className="pu-link" onClick={() => setUnitsKey(unitsOpen ? '' : key)}>
              {unitsOpen ? 'Hide inventory units' : 'Show inventory units'}
            </button>
            {unitsOpen && (
              <div className="pu-recipe">
                <div><div className="pu-part"><span>COUNTED FOR THIS ORDER · INVENTORY UNITS</span></div></div>
                {row.adjusted.map((part) => (
                  <div key={part.id} className="pu-line-row" style={{ cursor: 'default' }}>
                    <span>{part.name}</span>
                    <span className="pu-amt">{formatQty(part.quantity)} {part.unit || ''}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  function renderReview(group) {
    const { row, kind, sales } = group;
    const [label, bg, fg] = REVIEW_MARKS[kind];
    const open = openKey === group.key;
    const requests = requestList(row);
    const first = sales[0];
    const last = sales[sales.length - 1];
    const matching = kind === 'dish' || kind === 'new';
    const options = matching ? closestMenus(row.dish, data.menus) : [];
    const pick = match[group.key] ?? options[0]?.id ?? '';
    const picked = data.menus.find((menu) => menu.id === pick);
    const counted = planLines(row, data.ingredients);
    const counting = row.status === 'ready' && (kind === 'amount' || kind === 'untracked');
    const when = kind === 'new'
      ? `FIRST SEEN ${shortDate(group.button?.first_seen_at)}`
      : sales.length > 1
        ? `${shortDate(first.date)}${first.date === last.date ? '' : ` – ${shortDate(last.date)}`} · ${sales.length} SALES`
        : `${shortDate(first.date)} · #${first.ticket || '—'}`;

    return (
      <article key={group.key} className="pu-card" data-open={open ? '' : undefined}>
        <button
          type="button"
          className="pu-head"
          aria-expanded={open}
          onClick={() => setOpenKey(open ? '' : group.key)}
        >
          <span className="pu-mark" style={{ background: bg, color: fg }}>{label}</span>
          <span className="pu-title">
            <strong>
              {matching ? `“${row.dish}”` : row.dish}
              {sales.length > 1 && <span className="pu-count">×{sales.length}</span>}
            </strong>
            <span>
              {kind === 'new'
                ? 'On the POS with no dish yet · not sold yet'
                : kind === 'dish'
                  ? 'POS button with no matching dish'
                  : requests.length ? requests.join(' · ') : 'No requests'}
            </span>
          </span>
          <span className="pu-when">{when}</span>
        </button>

        {open && (
          <div className="pu-body">
            {sales.length > 1 && (
              <div className="pu-sales">
                {sales.map((sale) => (
                  <span key={`${sale.line_key}:${sale.unit_index || 0}`}>
                    {shortDate(sale.date)} · #{sale.ticket || '—'}
                  </span>
                ))}
              </div>
            )}

            {matching && (
              <>
                {options.length > 0 && (
                  <>
                    <span className="pu-label">Closest dishes on the menu</span>
                    <div className="pu-choices">
                      {options.map((menu) => (
                        <button
                          key={menu.id}
                          type="button"
                          aria-pressed={pick === menu.id}
                          onClick={() => setMatch({ ...match, [group.key]: menu.id })}
                        >
                          {menu.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <Picker
                  value={options.some((menu) => menu.id === pick) ? '' : pick}
                  search
                  placeholder="Search all dishes"
                  ariaLabel={`Search dishes for ${row.dish}`}
                  disabled={busy}
                  options={[...data.menus]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((menu) => ({ value: menu.id, label: menu.name }))}
                  onChange={(id) => {
                    if (id) setMatch({ ...match, [group.key]: id });
                  }}
                />
                <div className="pu-buttons">
                  <button
                    type="button"
                    className="om-pri"
                    disabled={busy || !picked}
                    onClick={() => act('map', { itemRef: row.item_ref, menuId: pick })}
                  >
                    {picked ? `Confirm ${picked.name}` : 'Choose a dish'}
                  </button>
                  <button
                    type="button"
                    className="om-btn"
                    disabled={busy}
                    onClick={() => openNewDish(row, group.button)}
                  >
                    Add as a new dish
                  </button>
                  <button
                    type="button"
                    className="om-btn"
                    disabled={busy}
                    onClick={() => setNoting({ name: row.dish, text: '' })}
                  >
                    Leave a note
                  </button>
                  <button
                    type="button"
                    className="om-btn"
                    disabled={busy}
                    onClick={() => act('map', { itemRef: row.item_ref, menuId: '__exclude__' })}
                  >
                    Not food, skip it
                  </button>
                </div>
                <p className="pu-note">
                  Nothing changes until you choose. Every past and future sale of this button then counts as that dish.
                </p>
              </>
            )}

            {!matching && (
              <>
                {kind === 'untracked' && (
                  <div className="pu-counted">
                    <strong>Not counted: {row.plan.untracked.join(', ')}</strong>
                    <span>Not one of your ingredients, so it is left out. Everything else in the dish is counted.</span>
                  </div>
                )}

                {(kind === 'retry' || kind === 'weight') && row.reason && (
                  <div className="pu-reason">{row.reason}</div>
                )}

                {row.base?.length > 0 && renderRecipe(
                  row,
                  counting ? row.plan?.explanation : kind === 'amount' ? row.reason : null
                )}

                <div className="pu-buttons">
                  {counting && (
                    <button
                      type="button"
                      className="om-pri"
                      disabled={busy}
                      onClick={async () => {
                        const result = await act('confirm', { contextKey: row.context_key });
                        if (result) offerOthers(row, result.plan);
                      }}
                    >
                      {kind === 'untracked'
                        ? 'OK, leave it out'
                        : sales.length > 1 ? `Correct, count all ${sales.length}` : 'Correct'}
                    </button>
                  )}
                  {kind === 'amount' && !counting && row.context_key && (
                    <button type="button" className="om-pri" disabled={busy} onClick={() => saveDish(row, null)}>
                      Save as shown
                    </button>
                  )}
                  {kind === 'retry' && (
                    <button type="button" className="om-btn" disabled={busy} onClick={() => act('prepare')}>
                      Retry now
                    </button>
                  )}
                  {kind === 'weight' && (
                    <button
                      type="button"
                      className="om-pri"
                      onClick={() => {
                        const ingredient = weightIngredient(row);
                        router.push({
                          pathname: '/admin/pos-conversions',
                          query: ingredient
                            ? { restaurant: restaurantId, ingredient: ingredient.id }
                            : { restaurant: restaurantId },
                        });
                      }}
                    >
                      Set the weight
                    </button>
                  )}
                </div>

                {(counting || kind === 'amount') && (
                  <p className="pu-note">
                    {counting
                      ? 'Already counted. Click any line to change it. Your answer is used for every sale of this dish with these requests, past and future.'
                      : 'Click a line to set its amount, or add what the kitchen used. Saving uses these amounts for every sale of this dish with these requests.'}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </article>
    );
  }

  function renderDone({ row, count }) {
    const key = `done:${row.line_key}`;
    const open = openKey === key;
    const requests = requestList(row);
    const [label, bg, fg] = row.status === 'excluded'
      ? ['Not food', 'var(--panel)', 'var(--muted)']
      : row.origin === 'admin'
        ? ['Reviewed by you', 'var(--green-tint)', 'var(--green)']
        : ['Automatic', 'var(--panel)', 'var(--muted)'];

    return (
      <div key={key} className="pu-done">
        <button
          type="button"
          className="pu-done-row"
          aria-expanded={open}
          onClick={() => setOpenKey(open ? '' : key)}
        >
          <strong>
            {row.dish}
            {count > 1 && <span className="pu-count">×{count}</span>}
          </strong>
          <span className="pu-req">{requests.length ? requests.join(' · ') : 'No requests'}</span>
          <span className="pu-when">#{row.ticket || '—'}</span>
          <span><span className="pu-mark" style={{ background: bg, color: fg }}>{label}</span></span>
        </button>
        {open && row.status !== 'excluded' && (
          <div style={{ padding: '0 18px 16px' }}>{renderRecipe(row, row.plan?.explanation)}</div>
        )}
      </div>
    );
  }

  const setupCard = data && !data.settings && (
    <section style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--muted)', flex: '1 1 220px' }}>
        Start with tickets dated
        <input className="om-field" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
      </label>
      <button type="button" className="om-pri" disabled={busy} onClick={() => act('setup', { startDate })}>
        Set up preview
      </button>
    </section>
  );

  return (
    <AdminShell
      section="Platform"
      sub="Ingredient usage"
      title="POS ingredient usage"
    >
      <style jsx global>{`
        .om-app .pu-seg { display: flex; background: var(--panel); border-radius: 10px; padding: 3px; gap: 2px; }
        .om-app .pu-seg button { flex: 1; min-height: 34px; border: 0; border-radius: 8px; background: transparent; font: 600 12.5px 'Manrope', sans-serif; color: var(--muted); cursor: pointer; white-space: nowrap; padding: 0 12px; }
        .om-app .pu-seg button[aria-pressed="true"] { background: var(--shell); color: var(--text); box-shadow: 0 1px 2px rgba(17,24,25,0.10); }
        .om-app .pu-portion input { text-align: right; font-family: 'IBM Plex Mono', monospace; }
        .om-app .pu-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .om-app .pu-day { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--muted); }
        .om-app .pu-day select { width: auto; min-height: 38px; border-radius: 19px; padding: 0 14px; }
        .om-app .pu-arrows { display: flex; align-items: center; gap: 6px; }
        .om-app .pu-arrows button { width: 40px; height: 40px; padding: 0; border-radius: 20px; border: 1px solid var(--line); background: var(--shell); color: var(--text); display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .om-app .pu-arrows button:disabled { opacity: 0.4; cursor: default; }
        .om-app .pu-arrows span { min-width: 130px; text-align: center; font-size: 15px; font-weight: 800; }
        .om-app .pu-note { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.5; }
        .om-app .pu-list { display: flex; flex-direction: column; gap: 10px; }
        .om-app .pu-card { background: var(--shell); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
        .om-app .pu-card[data-open] { border: 2px solid var(--accent); }
        .om-app .pu-head { width: 100%; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 14px 18px; border: 0; background: transparent; text-align: left; cursor: pointer; color: var(--text); font: inherit; }
        .om-app .pu-mark { display: inline-block; font-size: 11.5px; font-weight: 800; padding: 4px 10px; border-radius: 10px; white-space: nowrap; }
        .om-app .pu-title { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .om-app .pu-title strong { font-size: 15px; font-weight: 800; }
        .om-app .pu-title > span { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
        .om-app .pu-count { font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600; background: var(--panel); color: var(--text); padding: 2px 7px; border-radius: 8px; margin-left: 6px; }
        .om-app .pu-when { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: var(--muted); }
        .om-app .pu-body { border-top: 1px solid var(--line-soft); padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
        .om-app .pu-sales { display: flex; gap: 8px; flex-wrap: wrap; }
        .om-app .pu-sales span { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; background: var(--panel); border-radius: 8px; padding: 6px 10px; }
        .om-app .pu-label { font-size: 13px; font-weight: 700; }
        .om-app .pu-choices { display: flex; gap: 8px; flex-wrap: wrap; }
        .om-app .pu-choices button { min-height: 42px; padding: 0 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--shell); font: 600 13.5px 'Manrope', sans-serif; color: var(--text); cursor: pointer; }
        .om-app .pu-choices button[aria-pressed="true"] { border: 2px solid var(--accent); background: var(--accent-tint); font-weight: 700; }
        .om-app .pu-counted { background: var(--amber-tint); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
        .om-app .pu-reason { background: var(--red-tint); border-radius: 8px; padding: 10px 12px; font-size: 13px; line-height: 1.55; }
        .om-app .pu-buttons { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .om-app .pu-more { cursor: pointer; color: var(--accent-deep); font-size: 12.5px; font-weight: 700; padding: 4px 0; }
        .om-app .pu-done-list { background: var(--shell); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
        .om-app .pu-done + .pu-done { border-top: 1px solid var(--line-soft); }
        .om-app .pu-done-row { width: 100%; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.6fr) 110px 150px; gap: 12px; align-items: center; padding: 13px 18px; border: 0; background: transparent; text-align: left; font: inherit; color: var(--text); cursor: pointer; }
        .om-app .pu-done-row strong { font-size: 13.5px; font-weight: 700; }
        .om-app .pu-req { font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
        .om-app .pu-empty { margin: 0; color: var(--muted); font-size: 13px; padding: 14px 18px; }
        .om-app .pu-offer { display: flex; gap: 14px; align-items: flex-start; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; cursor: pointer; }
        .om-app .pu-offer input { width: 20px; height: 20px; margin-top: 2px; accent-color: var(--accent); }
        .om-app .pu-lines { display: flex; flex-direction: column; gap: 8px; }
        .om-app .pu-line { display: grid; grid-template-columns: minmax(0, 1fr) 90px 100px 40px; gap: 8px; align-items: start; }
        .om-app .pu-line[data-missing] { background: var(--amber-tint); border-radius: 10px; padding: 6px; }
        .om-app .pu-line input { text-align: right; font-family: 'IBM Plex Mono', monospace; }
        .om-app .pu-view { display: flex; flex-direction: column; gap: 10px; }
        .om-app .pu-recipe { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--shell); }
        .om-app .pu-part { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 9px 16px; background: var(--panel); font: 600 10.5px 'IBM Plex Mono', monospace; letter-spacing: 0.12em; color: var(--muted); border-top: 1px solid var(--line); }
        .om-app .pu-recipe > div:first-child > .pu-part { border-top: 0; }
        .om-app .pu-why { font: 700 11px 'Manrope', sans-serif; letter-spacing: 0; padding: 3px 9px; border-radius: 9px; background: var(--shell); color: var(--muted); white-space: nowrap; }
        .om-app .pu-why[data-tone="removed"] { background: var(--red-tint); color: var(--red); }
        .om-app .pu-why[data-tone="added"] { background: var(--green-tint); color: var(--green); }
        .om-app .pu-line-row { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 16px; border: 0; border-top: 1px solid var(--line-soft); background: transparent; color: var(--text); font: 500 14px 'Manrope', sans-serif; text-align: left; cursor: pointer; }
        .om-app .pu-line-row:hover:not(:disabled) { background: var(--accent-tint); }
        .om-app .pu-line-row:disabled { cursor: default; }
        .om-app .pu-line-row em { font-style: normal; color: var(--muted); font-size: 12.5px; margin-left: 6px; }
        .om-app .pu-amt { font: 600 13.5px 'IBM Plex Mono', monospace; white-space: nowrap; }
        .om-app .pu-line-row[data-state="removed"] { color: var(--muted); }
        .om-app .pu-line-row[data-state="removed"] .pu-amt { color: var(--red); text-decoration: line-through; }
        .om-app .pu-line-row[data-state="added"] .pu-amt { color: var(--green); }
        .om-app .pu-line-row[data-state="adjusted"] .pu-amt { color: #24508f; }
        .om-app .pu-line-row[data-state="merged"] .pu-amt { color: var(--muted); font-weight: 500; }
        .om-app .pu-guess { font: 700 10.5px 'Manrope', sans-serif; background: var(--amber-tint); color: var(--amber); padding: 2px 7px; border-radius: 8px; margin-left: 8px; }
        .om-app .pu-add-row { color: var(--accent-deep); font-weight: 700; }
        .om-app .pu-link { align-self: flex-start; border: 0; background: transparent; padding: 0; color: var(--accent-deep); font: 700 12.5px 'Manrope', sans-serif; cursor: pointer; }
        .om-app .pu-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .om-app .pu-facts > div { background: var(--panel); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; font-weight: 600; color: var(--muted); }
        .om-app .pu-facts strong { font: 600 15px 'IBM Plex Mono', monospace; color: var(--text); }
        .om-app .pu-facts > div[data-state="added"] { background: var(--green-tint); }
        .om-app .pu-facts > div[data-state="added"] strong { color: var(--green); }
        .om-app .pu-facts > div[data-state="removed"] { background: var(--red-tint); }
        .om-app .pu-facts > div[data-state="removed"] strong { color: var(--red); }
        .om-app .pu-facts > div[data-state="adjusted"] strong { color: #24508f; }
        .om-app .pu-remove { min-height: 42px; padding: 0 4px; border: 0; background: transparent; color: var(--red); font: 700 13.5px 'Manrope', sans-serif; cursor: pointer; }
        @media (max-width: 700px) {
          .om-app .pu-done-row { display: flex; flex-wrap: wrap; gap: 6px 12px; }
          .om-app .pu-done-row strong { flex: 1 1 100%; }
          .om-app .pu-line { grid-template-columns: minmax(0, 1fr) 76px 86px 36px; }
        }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: isPhone ? 14 : 18 }}>
        <PageHead
          kicker={data?.settings
            ? (data.settings.enabled
              ? `PLATFORM · COUNTING SINCE ${shortDate(data.settings.start_date)}`
              : `PLATFORM · PREVIEW FROM ${shortDate(data.settings.start_date)}`)
            : 'PLATFORM'}
          title="Ingredient usage"
          sub={isPhone ? undefined : 'What every dish sold took out of inventory.'}
        >
          {!isPhone && selectRestaurant}
          {!isPhone && actions}
        </PageHead>

        {isPhone && selectRestaurant}
        {isPhone && actions && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>
        )}

        {message && <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p>}

        {setupCard}

        {data?.job?.last_error && (
          <div className="pu-reason">Last worker error: {data.job.last_error}</div>
        )}

        {typedMissing && data?.settings && (
          <div className="pu-reason" style={{ background: 'var(--amber-tint)' }}>
            <strong>Typed kitchen requests are incomplete.</strong> Preset modifiers are applied. Typed requests are included once Shift4 lookup access is on.
          </div>
        )}

        {data?.settings && (
          <>
            <div className="pu-bar">
              <Segmented
                label="View"
                value={view}
                onChange={(key) => {
                  setView(key);
                  setOpenKey('');
                }}
                options={[
                  ['review', `Needs review · ${reviewGroups.length}`],
                  ['done', 'Done'],
                ]}
              />

              {view === 'review' ? (
                <label className="pu-day">
                  Day
                  <select
                    className="om-field"
                    value={reviewDay}
                    onChange={(event) => setReviewDay(event.target.value)}
                  >
                    <option value="all">All days</option>
                    {days.map((day) => (
                      <option key={day} value={day}>{longDate(day)}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="pu-arrows">
                  <button
                    type="button"
                    aria-label="Previous day"
                    disabled={dayIndex <= 0}
                    onClick={() => {
                      setDoneDay(days[dayIndex - 1]);
                      setOpenKey('');
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                  </button>
                  <span>{shownDay ? longDate(shownDay) : '—'}</span>
                  <button
                    type="button"
                    aria-label="Next day"
                    disabled={dayIndex < 0 || dayIndex >= days.length - 1}
                    onClick={() => {
                      setDoneDay(days[dayIndex + 1]);
                      setOpenKey('');
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
                  </button>
                </div>
              )}
            </div>

            {view === 'review' ? (
              <>
                <p className="pu-note">
                  Oldest first. Each answer is remembered for that dish with those same requests.
                </p>
                <div className="pu-list">
                  {visibleGroups.map(renderReview)}
                  {!visibleGroups.length && (
                    <p className="pu-empty" style={{ padding: 8 }}>
                      {report.length
                        ? 'Nothing needs review.'
                        : 'Usage is prepared after each POS sync.'}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="pu-note">
                  Every dish sold this day, with or without requests · {doneLines.length} counted · {waitingToday} still in Needs review
                </p>
                <div className="pu-done-list">
                  {doneLines.map(renderDone)}
                  {!doneLines.length && (
                    <p className="pu-empty">No counted dishes this day.</p>
                  )}
                </div>
              </>
            )}

            <p className="pu-note" style={{ paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
              {data.settings.enabled
                ? (applied
                  ? 'Counting into inventory · up to date.'
                  : 'Counting into inventory · waiting for the background update.')
                : 'Preview only. Inventory is unchanged until you choose Use for inventory.'}
            </p>
          </>
        )}

        {!restaurantId && (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>
            Choose a restaurant to see its ingredient usage.
          </p>
        )}
      </div>

      {editing && (
        <Dialog
          title={editing.dish}
          sub="Set portions for one serving"
          width={560}
          showCloseButton
          onClose={() => { if (!busy) setEditing(null); }}
        >
          {(() => {
            const modifiers = editing.instructions?.modifiers || [];
            const requests = [
              ...(editing.instructions?.requests || []),
              ...modifiers.flatMap((modifier) => modifier.requests || []),
            ].filter((text) => text && text.trim());

            return (
              <>
                {(modifiers.length > 0 || requests.length > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {modifiers.map((modifier, i) => (
                      <span key={`m${i}`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '0 9px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: 'var(--accent-tint)', color: 'var(--accent-deep)' }}>{modifier.name}</span>
                    ))}
                    {requests.map((text, i) => (
                      <span key={`r${i}`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '0 9px', borderRadius: 12, fontSize: 12, fontWeight: 600, border: '1px solid var(--amber)', color: 'var(--amber)' }}>TYPED · {text}</span>
                    ))}
                  </div>
                )}

                <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 100px 96px 36px', gap: 8, padding: '7px 12px', background: 'var(--panel)', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>
                    <span>INGREDIENT</span><span>ONE SERVING</span><span>UNIT</span><span />
                  </div>
                  {portions.map((portion, index) => {
                    const ingredient = data.ingredients.find((candidate) => candidate.id === portion.id);
                    const needed = portion.quantity === '';
                    return (
                      <label key={portion.id} className="pu-portion" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 100px 96px 36px', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--line-soft)', alignItems: 'center', fontSize: 13.5, background: needed ? 'var(--amber-tint)' : 'transparent' }}>
                        <span style={{ fontWeight: needed ? 700 : 600, minWidth: 0, overflowWrap: 'anywhere' }}>
                          {ingredient?.name}
                          {portion.from?.length > 0 && (
                            <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, fontWeight: 500, color: 'var(--muted)' }}>
                              {portion.from.join(' · ')}
                            </span>
                          )}
                          {needed && <span style={{ display: 'block', marginTop: 2, fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: 'var(--amber)' }}>NEEDED</span>}
                        </span>
                        <input
                          className="om-field"
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          aria-label={`${ingredient?.name} quantity`}
                          value={portion.quantity}
                          disabled={busy}
                          style={{ borderColor: needed ? 'var(--amber)' : undefined }}
                          onChange={(event) =>
                            setPortions(portions.map((value, i) =>
                              i === index ? { ...value, quantity: event.target.value } : value
                            ))
                          }
                        />
                        <select
                          className="om-field"
                          aria-label={`${ingredient?.name} unit`}
                          value={portion.unit || ingredient?.unit || ''}
                          disabled={busy}
                          style={{ padding: '0 6px' }}
                          onChange={(event) =>
                            setPortions(portions.map((value, i) =>
                              i === index ? { ...value, unit: event.target.value } : value
                            ))
                          }
                        >
                          {[...new Set([portion.unit || ingredient?.unit, ...UNITS])]
                            .filter(Boolean)
                            .map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                        </select>
                        <button
                          type="button"
                          aria-label={`Remove ${ingredient?.name || 'this ingredient'}`}
                          title="Remove"
                          disabled={busy}
                          onClick={(event) => {
                            event.preventDefault();
                            setPortions(portions.filter((_, i) => i !== index));
                          }}
                          style={{ width: 32, height: 32, padding: 0, border: '1px solid var(--line)', borderRadius: '50%', background: 'var(--shell)', color: 'var(--muted)', font: "400 18px/1 'Manrope', sans-serif", cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          ×
                        </button>
                      </label>
                    );
                  })}
                </div>

                <Picker
                  value=""
                  search
                  placeholder="Search to add an ingredient"
                  ariaLabel="Add an ingredient"
                  disabled={busy}
                  options={data.ingredients
                    .filter((ingredient) =>
                      !portions.some((portion) => portion.id === ingredient.id)
                    )
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((ingredient) => ({
                      value: ingredient.id,
                      label: ingredient.name,
                      meta: ingredient.unit,
                    }))}
                  onChange={(id) => {
                    if (id) {
                      setPortions([...portions, {
                        id,
                        quantity: '',
                        unit: data.ingredients.find((ingredient) => ingredient.id === id)?.unit || '',
                      }]);
                    }
                  }}
                />

                <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--muted)', background: 'var(--panel)', borderRadius: 8, padding: '10px 12px' }}>
                  Saved as a rule for every <strong style={{ color: 'var(--text)' }}>{editing.dish}</strong> with these same instructions. Zero removes an ingredient. Other dishes are not changed.
                </div>

                <p className="pu-note">
                  Missing or wrong weights are fixed on the{' '}
                  <a
                    href={`/admin/pos-conversions?restaurant=${restaurantId}`}
                    style={{ color: 'var(--accent-deep)', fontWeight: 700 }}
                  >
                    Conversions page
                  </a>.
                </p>

                {message && <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p>}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button type="button" className="om-btn" disabled={busy} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="om-pri"
                    disabled={
                      busy ||
                      !portions.length ||
                      portions.some((portion) =>
                        portion.quantity === '' ||
                        !Number.isFinite(Number(portion.quantity)) ||
                        Number(portion.quantity) < 0
                      )
                    }
                    onClick={async () => {
                      const source = editing;
                      const result = await act('rule', {
                        contextKey: source.context_key,
                        portions: portions.map((portion) => ({
                          ...portion,
                          quantity: Number(portion.quantity),
                          unit: portion.unit ||
                            data.ingredients.find((ingredient) => ingredient.id === portion.id)?.unit,
                        })),
                      });

                      if (result) offerOthers(source, result.plan);
                    }}
                  >
                    {busy ? 'Saving…' : 'Save and reuse'}
                  </button>
                </div>
              </>
            );
          })()}
        </Dialog>
      )}

      {offer && (
        <Dialog
          title="Use the same idea on other dishes?"
          sub={`Saved for ${offer.dish}. These dishes also sold with ${offer.request}. Each one uses its own recipe amounts.`}
          width={600}
          showCloseButton
          onClose={() => { if (!busy) setOffer(null); }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {offer.candidates.map((candidate) => {
              const on = offer.checked.includes(candidate.contextKey);
              return (
                <label key={candidate.contextKey} className="pu-offer">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy}
                    onChange={() => setOffer({
                      ...offer,
                      checked: on
                        ? offer.checked.filter((key) => key !== candidate.contextKey)
                        : [...offer.checked, candidate.contextKey],
                    })}
                  />
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 14.5 }}>{candidate.dish}</strong>
                      <span className="pu-when">
                        {candidate.sales} {candidate.sales === 1 ? 'SALE' : 'SALES'}
                      </span>
                    </span>
                    {candidate.lines.map((text, i) => (
                      <span key={i} style={{ fontSize: 13, color: 'var(--muted)' }}>{text}</span>
                    ))}
                  </span>
                </label>
              );
            })}
            <p className="pu-note">Anything you leave unchecked stays in Needs review.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="om-btn" disabled={busy} onClick={() => setOffer(null)}>
              Just this dish
            </button>
            <button
              type="button"
              className="om-pri"
              disabled={busy || !offer.checked.length}
              onClick={async () => {
                const result = await act('apply', {
                  sourceKey: offer.sourceKey,
                  targetKeys: offer.checked,
                });

                if (result) setOffer(null);
              }}
            >
              {busy ? 'Saving…' : `Apply to ${offer.checked.length || ''} checked`.replace('  ', ' ')}
            </button>
          </div>
        </Dialog>
      )}

      {lineEdit && (() => {
        const line = lineEdit.line;
        const putBack = line?.state === 'removed';
        const ready = !busy &&
          lineEdit.ingredientId &&
          lineEdit.qty !== '' &&
          Number(lineEdit.qty) >= 0 &&
          lineEdit.unit;

        return (
          <Dialog
            title={line ? lineEdit.name : 'Add an ingredient'}
            sub={`${lineEdit.part} · ${lineEdit.row.dish}`}
            width={480}
            showCloseButton
            onClose={() => { if (!busy) setLineEdit(null); }}
          >
            {!line && (
              <Picker
                value={lineEdit.ingredientId}
                search
                placeholder="Search your ingredients"
                ariaLabel="Ingredient to add"
                disabled={busy}
                options={[...data.ingredients]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((ingredient) => ({
                    value: ingredient.id,
                    label: ingredient.name,
                    meta: ingredient.unit,
                  }))}
                onChange={(id) => {
                  const ingredient = data.ingredients.find((value) => value.id === id);
                  setLineEdit({
                    ...lineEdit,
                    ingredientId: id,
                    name: ingredient?.name || '',
                    unit: lineEdit.unit || ingredient?.unit || '',
                  });
                }}
              />
            )}

            {line && (
              <div className="pu-facts">
                <div>
                  <span>In the recipe</span>
                  <strong>{line.recipe || (line.instead ? `Instead of ${line.instead}` : 'Not in the recipe')}</strong>
                </div>
                <div data-state={line.state}>
                  <span>Counted for this order</span>
                  <strong>{putBack ? 'Removed' : amountText(line)}</strong>
                </div>
              </div>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 700 }}>
              Amount for this part of the plate
              <span style={{ display: 'flex', gap: 8 }}>
                <input
                  className="om-field"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  aria-label="Amount"
                  value={lineEdit.qty}
                  disabled={busy}
                  style={{ flex: 1, minHeight: 44, textAlign: 'right', fontFamily: MONO }}
                  onChange={(event) => setLineEdit({ ...lineEdit, qty: event.target.value })}
                />
                <select
                  className="om-field"
                  aria-label="Unit"
                  value={lineEdit.unit}
                  disabled={busy}
                  style={{ width: 110, minHeight: 44 }}
                  onChange={(event) => setLineEdit({ ...lineEdit, unit: event.target.value })}
                >
                  <option value="">Unit</option>
                  {[...new Set([lineEdit.unit, ...UNITS])].filter(Boolean).map((unit) => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
              </span>
            </label>

            <p className="pu-note">
              Only this line changes. Saved for every {lineEdit.row.dish} sold with these same requests.
            </p>

            {message && <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p>}

            <div className="pu-buttons">
              {line && !putBack && (
                <button
                  type="button"
                  className="pu-remove"
                  disabled={busy}
                  onClick={async () => {
                    const result = await saveDish(lineEdit.row, { line, remove: true });
                    if (result) setLineEdit(null);
                  }}
                >
                  Remove from this order
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button type="button" className="om-btn" disabled={busy} onClick={() => setLineEdit(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="om-pri"
                disabled={!ready}
                onClick={async () => {
                  const result = await saveDish(lineEdit.row, {
                    line,
                    id: lineEdit.ingredientId,
                    qty: lineEdit.qty,
                    unit: lineEdit.unit,
                  });
                  if (result) setLineEdit(null);
                }}
              >
                {busy ? 'Saving…' : putBack ? 'Put it back' : 'Save'}
              </button>
            </div>
          </Dialog>
        );
      })()}

      {creating && (() => {
        const lineOptions = [
          ...(data?.preps || []).map((prep) => ({
            value: `prep:${prep.id}`,
            label: prep.name,
            meta: 'batch prep',
          })),
          ...[...(data?.ingredients || [])]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((ingredient) => ({
              value: ingredient.id,
              label: ingredient.name,
              meta: ingredient.unit,
            })),
        ];
        const ready = creating.name.trim() &&
          creating.lines.length &&
          creating.lines.every((line) =>
            (line.ingredient_id || line.prep_id) &&
            Number(line.quantity) > 0 &&
            UNITS.includes(line.unit)
          );

        return (
          <Dialog
            title="Add a new dish"
            sub={`From the POS button “${creating.button}”. Its sales count as estimates until the owner confirms the recipe.`}
            width={680}
            showCloseButton
            onClose={() => { if (!busy) setCreating(null); }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 700 }}>
              Dish name
              <input
                className="om-field"
                value={creating.name}
                disabled={busy}
                onChange={(event) => setCreating({ ...creating, name: event.target.value })}
              />
            </label>

            <div className="pu-buttons">
              <button
                type="button"
                className="om-btn"
                disabled={busy || !creating.name.trim()}
                onClick={draftRecipe}
              >
                {busy ? 'Working…' : creating.lines.length ? 'Draft again with OptiMenu' : 'Draft recipe with OptiMenu'}
              </button>
              {creating.lines.length > 0 && (
                <span className="pu-note">Check every amount before approving.</span>
              )}
            </div>

            {creating.notes && <p className="pu-note">{creating.notes}</p>}

            {creating.lines.length > 0 && (
              <div className="pu-lines">
                {creating.lines.map((line, index) => {
                  const value = line.prep_id ? `prep:${line.prep_id}` : line.ingredient_id || '';
                  return (
                    <div key={index} className="pu-line" data-missing={value ? undefined : ''}>
                      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Picker
                          value={value}
                          search
                          placeholder="Pick an ingredient"
                          ariaLabel={`Ingredient for line ${index + 1}`}
                          disabled={busy}
                          options={lineOptions}
                          onChange={(id) => { if (id) setLine(index, pickLine(id, line)); }}
                        />
                        {!value && line.name && (
                          <span className="pu-note">
                            OptiMenu suggested “{line.name}”, which is not one of your ingredients.
                          </span>
                        )}
                      </div>
                      <input
                        className="om-field"
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        aria-label={`Amount for line ${index + 1}`}
                        value={line.quantity}
                        disabled={busy}
                        onChange={(event) => setLine(index, { quantity: event.target.value })}
                      />
                      <select
                        className="om-field"
                        aria-label={`Unit for line ${index + 1}`}
                        value={line.unit}
                        disabled={busy}
                        onChange={(event) => setLine(index, { unit: event.target.value })}
                      >
                        <option value="">Unit</option>
                        {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                      </select>
                      <button
                        type="button"
                        className="om-btn"
                        aria-label={`Remove line ${index + 1}`}
                        disabled={busy}
                        style={{ justifyContent: 'center', padding: 0 }}
                        onClick={() => setCreating({
                          ...creating,
                          lines: creating.lines.filter((_, i) => i !== index),
                        })}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <Picker
              value=""
              search
              placeholder="Search to add an ingredient or batch prep"
              ariaLabel="Add an ingredient"
              disabled={busy}
              options={lineOptions}
              onChange={(id) => {
                if (id) {
                  setCreating({
                    ...creating,
                    lines: [
                      ...creating.lines,
                      pickLine(id, { quantity: '', unit: '', component: 'Recipe' }),
                    ],
                  });
                }
              }}
            />

            <div className="pu-counted">
              <strong>Until the owner confirms</strong>
              <span>
                The dish shows on the owner recipe page as an estimate and stays off their costs. Its sales count as estimates. The owner gets a notification to check it, and once they confirm, past sales are recounted from their recipe.
              </span>
            </div>

            {message && <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="om-btn" disabled={busy} onClick={() => setCreating(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="om-btn"
                disabled={busy}
                onClick={() => {
                  setNoting({ name: creating.button, text: '' });
                  setCreating(null);
                }}
              >
                Leave a note instead
              </button>
              <button
                type="button"
                className="om-pri"
                disabled={busy || !ready}
                onClick={async () => {
                  const name = creating.name.trim();
                  const result = await act('add-dish', {
                    itemRef: creating.itemRef,
                    name,
                    price: creating.price,
                    category: creating.category,
                    notes: creating.notes,
                    lines: creating.lines.map((line) => ({
                      ...line,
                      quantity: Number(line.quantity),
                    })),
                  });

                  if (result) {
                    setCreating(null);
                    setMessage(`Added ${name}. The owner was asked to confirm its recipe.`);
                  }
                }}
              >
                {busy ? 'Saving…' : 'Approve and send to owner'}
              </button>
            </div>
          </Dialog>
        );
      })()}

      {noting && (
        <Dialog
          title="Leave a note"
          sub={`About the POS button “${noting.name}”. This opens an admin ticket so you can come back to it.`}
          width={520}
          showCloseButton
          onClose={() => { if (!busy) setNoting(null); }}
        >
          <textarea
            className="om-field"
            rows={4}
            placeholder="What needs checking?"
            value={noting.text}
            disabled={busy}
            style={{ minHeight: 110, padding: 10, resize: 'vertical' }}
            onChange={(event) => setNoting({ ...noting, text: event.target.value })}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="om-btn" disabled={busy} onClick={() => setNoting(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="om-pri"
              disabled={busy || !noting.text.trim()}
              onClick={async () => {
                const result = await act('note', { name: noting.name, note: noting.text });
                if (result) {
                  setNoting(null);
                  setMessage('Note saved as an admin ticket.');
                }
              }}
            >
              {busy ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </Dialog>
      )}
    </AdminShell>
  );
}