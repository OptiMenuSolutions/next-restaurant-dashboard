import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import useIsPhone from '../../lib/admin/useIsPhone';
import { UNITS } from '../../lib/recipes/compile';
import Picker from './Picker';
import RecipeBuilder from './RecipeBuilder';
import { useLeaveGuard } from '../../lib/useLeaveGuard';
import LeaveGuardModal from '../LeaveGuardModal';

export async function recipeRequest(restaurantId, body, admin = false) {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) throw new Error('Please sign in again.');

  const url = admin
    ? '/api/admin/recipe-setup'
    : '/api/recipes/setup';

  const response = await fetch(
    body ? url : `${url}?restaurant_id=${restaurantId}`,
    {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      ...(body
        ? { body: JSON.stringify({ ...body, restaurant_id: restaurantId }) }
        : {}),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Could not save recipes.');
  }

  return result;
}

const clone = value => JSON.parse(JSON.stringify(value));

const blank = () => ({
  yield_quantity: '',
  yield_unit: 'oz',
  lines: [],
});

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

const card = {
  border: '1px solid var(--line)',
  borderRadius: 14,
  background: 'var(--shell)',
  minWidth: 0,
};

const label = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12.5,
  fontWeight: 600,
  color: 'var(--muted)',
};

const kicker = {
  fontFamily: MONO,
  fontSize: 10.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
};

const TONES = {
  green: ['var(--green-tint, #e9f5ec)', 'var(--green)'],
  amber: ['var(--amber-tint, #fbf3e2)', 'var(--amber)'],
  red: ['var(--red-tint, #fbeceb)', 'var(--red)'],
  accent: ['var(--accent-tint)', 'var(--accent-deep)'],
  muted: ['var(--panel)', 'var(--muted)'],
};

// Plain words for each saved status, shared by the list and the editor.
function statusOf(node) {
  if (node.status === 'confirmed') return { text: 'Confirmed', tone: 'green', key: 'confirmed' };
  if (node.status === 'estimated') return { text: 'Estimate · not in use yet', tone: 'amber', key: 'estimated' };
  if (node.status === 'skeleton') return { text: 'Needs amounts', tone: 'amber', key: 'skeleton' };
  if (node.status === 'imported') return { text: 'From your upload · in use', tone: 'accent', key: 'imported' };
  // An empty draft (a dish just read from the menu) isn't a recipe yet.
  if (node.status === 'draft' && (node.published || node.draft?.lines?.length)) {
    return node.published
      ? { text: 'Draft · old recipe in use', tone: 'accent', key: 'draft' }
      : { text: 'Draft', tone: 'accent', key: 'draft' };
  }
  if (node.published || node.draft?.lines?.length) {
    return { text: 'Current recipe', tone: 'muted', key: 'current' };
  }
  return { text: 'No recipe yet', tone: 'red', key: 'none' };
}

function Tag({ status }) {
  const [bg, fg] = TONES[status.tone];
  return (
    <span style={{ display: 'inline-block', fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', borderRadius: 5, padding: '3px 7px', whiteSpace: 'nowrap', background: bg, color: fg }}>
      {status.text}
    </span>
  );
}

function Icon({ d, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );
}

const ICONS = {
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></>,
  assisted: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />,
  manual: <><path d="M4 10h16v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" /><path d="M2 10h20M9 6.5c0-1 1-1.5 1-2.5M14 6.5c0-1 1-1.5 1-2.5" /></>,
  doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 6l-6 6 6 6" />,
};

export default function RecipeWorkspace({
  restaurantId,
  admin = false,
  onBusyChange,
  showHeading = true,
}) {
  const router = useRouter();
  const phone = useIsPhone();
  const [data, setData] = useState(null);
  const latest = useRef(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const stop = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState('dish');
  const [editor, setEditor] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [targets, setTargets] = useState({});
  const [looping, setLooping] = useState(false);
  const guard = useLeaveGuard(busy || dirty);

  const accept = result => {
    latest.current = result;
    setData(result);
    return result;
  };

  useEffect(() => {
    onBusyChange?.(busy || dirty);
  }, [busy, dirty, onBusyChange]);

  useEffect(() => {
    if (!restaurantId) return;

    setData(null);
    latest.current = null;

    let active = true;

    recipeRequest(restaurantId, undefined, admin)
      .then(result => {
        if (active) accept(result);
      })
      .catch(err => {
        if (active) setError(err.message);
      });

    return () => {
      active = false;
      stop.current = true;
    };
  }, [restaurantId, admin]);

  useEffect(() => {
    if (!data || dirty || busy) return;

    const selected = data.state.nodes.find(
      n => n.id === router.query.recipe
    );

    if (selected) {
      setEditor(clone(selected));
      setTab(selected.kind);
    } else if (router.query.recipe !== 'new') {
      setEditor(null);
      if (router.query.tab === 'prep' || router.query.tab === 'dish') setTab(router.query.tab);
    }
  }, [data, router.query.recipe, router.query.tab, dirty, busy]);

  async function post(body) {
    return accept(await recipeRequest(
      restaurantId,
      { revision: latest.current.revision, ...body },
      admin
    ));
  }

  async function run(work) {
    if (busyRef.current) return;

    busyRef.current = true;
    setBusy(true);
    setError('');
    setMessage('');

    try {
      await work();
    } catch (err) {
      setError(err.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function select(node) {
    if (
      dirty &&
      !window.confirm('Discard the unsaved changes to this recipe?')
    ) {
      return;
    }

    setDirty(false);
    setEditor(node ? clone(node) : null);

    const query = { ...router.query };

    if (node) query.recipe = node.id || 'new';
    else delete query.recipe;

    router.push(
      { pathname: router.pathname, query },
      undefined,
      { shallow: true, scroll: false }
    );
  }

  const edit = changes => {
    setEditor(old => ({ ...old, ...changes }));
    setDirty(true);
  };

  const editDefinition = changes => {
    edit({ draft: { ...editor.draft, ...changes } });
  };

  function lineChange(index, changes) {
    editDefinition({
      lines: editor.draft.lines.map((line, i) =>
        i === index ? { ...line, ...changes } : line
      ),
    });
  }

  // Admin only: drafts any dishes the background pass hasn't reached.
  async function generate() {
    stop.current = false;
    setLooping(true);

    try {
      while (latest.current.draftLeft > 0 && !stop.current) {
        setMessage(`${latest.current.draftLeft} dishes still need a draft…`);
        await post({ action: 'assist' });
      }

      setMessage(
        stop.current
          ? 'Progress saved. You can resume later.'
          : 'Drafts saved. Estimated recipes are active and awaiting kitchen confirmation.'
      );
    } finally {
      setLooping(false);
    }
  }

  // Lists each dish's components and ingredients from the menu, with no amounts.
  async function buildSkeletons() {
    stop.current = false;
    setLooping(true);

    try {
      while (latest.current.skeletonLeft > 0 && !stop.current) {
        const left = latest.current.skeletonLeft;
        setMessage(`Reading your menu… ${left} ${left === 1 ? 'dish' : 'dishes'} to go`);
        await post({ action: 'skeleton' });
      }

      setMessage(
        stop.current
          ? 'Progress saved. You can resume later.'
          : 'Skeletons ready. Every amount is blank. Open each dish to fill them in, then confirm it.'
      );
    } finally {
      setLooping(false);
    }
  }

  async function savePrep(prep) {
    let result = null;

    await run(async () => {
      result = await post({ action: 'confirm', node: prep });
      setMessage(`${prep.name} saved as a batch prep.`);
    });

    return result;
  }

  async function choose(method, build) {
    if (dirty) {
      setError('Save this recipe draft before changing setup methods.');
      return;
    }

    await post({ action: 'method', method, ...(build ? { build } : {}) });

    if (method === 'assisted' && admin) {
      setMessage('Drafting has started in the background.');
    }

    if (build === 'skeleton') {
      await buildSkeletons();
    }
  }

  async function upload(file) {
    if (!file) return;

    const mime = file.type || (
      /\.csv$/i.test(file.name)
        ? 'text/csv'
        : /\.txt$/i.test(file.name)
          ? 'text/plain'
          : ''
    );

    const signed = await post({
      action: 'sign',
      mime,
      size: file.size,
      name: file.name,
    });

    const { error: uploadError } = await supabase.storage
      .from('recipe-books')
      .uploadToSignedUrl(
        signed.path,
        signed.token,
        file,
        { contentType: mime }
      );

    if (uploadError) throw uploadError;

    setMessage('Reading your document…');

    await post({
      action: 'import',
      path: signed.path,
      name: file.name,
    });

    // During onboarding the "Upload worked" card says what happened.
    if (!admin && router.pathname.startsWith('/client/onboarding')) {
      setMessage('');
      return;
    }

    const entry = latest.current.state.imports.find(f => f.path === signed.path);
    const left = (entry?.items || []).filter(item => !item.adopted).length;

    setMessage(
      left
        ? `Read. Recipes that matched a dish or batch by name were saved as drafts. Choose where the other ${left === 1 ? 'one goes' : `${left} go`}.`
        : 'Read. Every recipe was matched by name and saved as a draft. Check the amounts, then confirm each one.'
    );
  }

  async function save(confirm, node = editor) {
    const result = await post({
      action: confirm ? 'confirm' : 'save',
      node,
    });

    const saved = result.state.nodes.find(n => n.id === node.id)
      || result.state.nodes[result.state.nodes.length - 1];

    setDirty(false);
    setEditor(clone(saved));

    await router.replace(
      {
        pathname: router.pathname,
        query: { ...router.query, recipe: saved.id },
      },
      undefined,
      { shallow: true, scroll: false }
    );

    setMessage(
      confirm
        ? result.released?.length
          ? `Confirmed. Also put into use: ${result.released.join(', ')}.`
          : 'Recipe confirmed. Calculations are queued.'
        : 'Draft saved. The active recipe is unchanged.'
    );
  }

  if (!data) {
    return (
      <div role="status" style={{ ...card, padding: 18, fontSize: 13.5, color: error ? 'var(--red)' : 'var(--muted)' }}>
        {error || 'Loading recipes…'}
      </div>
    );
  }

  const nodes = data.state.nodes;
  const dishes = nodes.filter(n => n.kind === 'dish');
  const preps = nodes.filter(n => n.kind === 'prep');
  const shown = nodes.filter(n => n.kind === tab);

  // Admin works in two queues: the owner's own uploads to check and approve,
  // and everything OptiMenu has to build with the kitchen.
  const queueOf = node => (
    node.status === 'confirmed' || statusOf(node).key === 'current'
      ? 'done'
      : node.source === 'upload' ? 'approve' : 'build'
  );
  const groups = admin
    ? [
        ['Check and approve now', 'The owner’s own recipes. Uploads go into use as soon as nothing is holding them.', shown.filter(n => queueOf(n) === 'approve')],
        ['To build with the kitchen', 'OptiMenu’s estimates and dishes with no recipe. They stay off the owner’s costs until you confirm them.', shown.filter(n => queueOf(n) === 'build')],
        ['Done', 'Confirmed and in use.', shown.filter(n => queueOf(n) === 'done')],
      ].filter(([, , items]) => items.length)
    : [[null, null, shown]];

  const unitOptions = value => [
    ...(UNITS.includes(value) ? [] : [{ value, label: value || 'Choose unit' }]),
    ...UNITS.map(unit => ({ value: unit, label: unit })),
  ];

  // Progress across dishes, by plain status. Skeletons have no amounts yet,
  // so they don't count as having a recipe.
  const counts = { confirmed: 0, current: 0, estimated: 0, imported: 0, draft: 0, skeleton: 0, none: 0 };
  dishes.forEach(n => { counts[statusOf(n).key] += 1; });
  const withRecipe = dishes.length - counts.none - counts.skeleton;
  const parts = [
    ['Confirmed', counts.confirmed, 'var(--green)'],
    ['Current', counts.current, 'var(--faint)'],
    ['Estimated', counts.estimated, 'var(--amber)'],
    ['From upload', counts.imported, 'var(--accent-deep)'],
    ['Draft', counts.draft, 'var(--accent)'],
    ['Needs amounts', counts.skeleton, 'var(--amber)'],
    ['No recipe', counts.none, 'var(--red)'],
  ].filter(([, n]) => n > 0);

  const methods = [
    ['upload', 'Upload recipes', 'PDFs, photos or spreadsheets of your prep book.'],
    ['assisted', 'Work with OptiMenu', 'We draft your recipes. You review them with us on a short setup call.'],
    ['manual', 'Build them myself', 'Start from your menu or from blank. Batch preps first, then each plate.'],
  ];

  // During onboarding, the list and editor only appear once the chosen
  // method has something to show. The Recipes page and admin always show them.
  const method = data.state.method;
  const progressive = !admin && router.pathname.startsWith('/client/onboarding');
  const uploadDone = data.state.imports.some(f => f.parsed);
  // During onboarding, once an upload is read, the result card replaces the method cards.
  const hideMethods = progressive && method === 'upload' && uploadDone;
  const missing = dishes.filter(n => statusOf(n).key === 'none');
  // During onboarding an upload goes to OptiMenu to check, so the owner
  // doesn't review it here. Only building recipes yourself opens the list.
  const showWork = !progressive || (method === 'manual' && !!data.state.build);

  const prepFor = id => nodes.find(n => n.id === id && n.kind === 'prep');

  function switchTab(key) {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;

    setDirty(false);
    setEditor(null);
    setTab(key);

    const query = { ...router.query };
    delete query.recipe;
    query.tab = key;

    router.push(
      { pathname: router.pathname, query },
      undefined,
      { shallow: true, scroll: false }
    );
  }

  const list = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div role="group" aria-label="Recipe type" style={{ display: 'flex', background: 'var(--panel)', borderRadius: 10, padding: 3, gap: 2 }}>
        {[
          ['dish', `Dishes · ${dishes.length}`],
          ['prep', `Batch preps · ${preps.length}`],
        ].map(([key, text]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            disabled={busy}
            onClick={() => switchTab(key)}
            style={{ flex: 1, minHeight: 36, border: 0, borderRadius: 8, cursor: 'pointer', font: "600 13px 'Manrope', sans-serif", background: tab === key ? 'var(--shell)' : 'transparent', color: tab === key ? 'var(--text)' : 'var(--muted)', boxShadow: tab === key ? '0 1px 2px rgba(17,24,25,0.10)' : 'none' }}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === 'prep' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => select({ kind: 'prep', name: '', notes: '', draft: blank() })}
          style={{ ...button, minHeight: 44, border: '1px dashed var(--line)', color: 'var(--accent-deep)' }}
        >
          <Icon d={ICONS.plus} size={14} />
          Add a batch prep
        </button>
      )}

      {groups.map(([title, hint, items]) => (
        <div key={title || 'all'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {title && (
            <div style={{ marginTop: 6 }}>
              <div style={{ ...kicker, color: 'var(--text)', fontWeight: 600 }}>{title} · {items.length}</div>
              <div style={{ marginTop: 2, fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>{hint}</div>
            </div>
          )}
          {items.map(node => {
        const status = statusOf(node);
        const on = editor?.id === node.id;
        const def = node.published || node.draft;
        const meta = node.kind === 'prep'
          ? (def?.yield_quantity ? `${def.yield_quantity} ${def.yield_unit} BATCH` : 'YIELD NOT SET')
          : String(node.menu_section || node.section || 'DISH').toUpperCase();

        return (
          <button
            key={node.id}
            type="button"
            disabled={busy}
            onClick={() => select(node)}
            aria-current={on ? 'true' : undefined}
            style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', textAlign: 'left', cursor: 'pointer', color: 'var(--text)', font: "inherit", borderColor: on ? 'var(--accent)' : 'var(--line)', background: on ? 'var(--accent-tint)' : 'var(--shell)' }}
          >
            {node.kind === 'prep' && (
              <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--panel)', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon d={ICONS.manual} />
              </span>
            )}
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{node.name || 'Untitled'}</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--muted)' }}>{meta}</span>
                <Tag status={status} />
              </span>
              {admin && data.holds?.[node.id] && (
                <span style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--amber)' }}>{data.holds[node.id]}</span>
              )}
            </span>
            {phone && (
              <span style={{ color: 'var(--faint)', display: 'flex' }}><Icon d={<path d="M9 6l6 6-6 6" />} size={16} /></span>
            )}
          </button>
        );
          })}
        </div>
      ))}

      {!shown.length && (
        <p style={{ margin: 0, padding: '10px 4px', fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
          {tab === 'prep'
            ? 'Add salsa, sauces, mashed potatoes or anything prepared in a batch.'
            : 'Upload your menu first to fill the dish list.'}
        </p>
      )}
    </div>
  );

  const lineCols = phone
    ? null
    : editor?.kind === 'prep'
      ? 'minmax(0, 2fr) 90px 96px 36px'
      : 'minmax(0, 2fr) 90px 96px minmax(0, 1fr) 36px';

  const editorPanel = editor && (
    <section style={{ ...card, boxShadow: '0 1px 1px rgba(17,24,25,0.05), 0 3px 6px rgba(17,24,25,0.07)' }}>
      <div style={{ padding: phone ? '16px' : '18px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={kicker}>
            {editor.kind === 'prep' ? 'Batch prep' : `Dish${editor.menu_section ? ` · ${editor.menu_section}` : ''}`}
          </div>
          <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', overflowWrap: 'anywhere' }}>
            {editor.name || (editor.kind === 'prep' ? 'New batch prep' : 'Untitled dish')}
          </h2>
          <div style={{ marginTop: 8 }}>
            <Tag status={dirty ? { text: 'Unsaved changes', tone: 'accent' } : statusOf(editor)} />
          </div>
        </div>
        {!phone && (
          <button
            type="button"
            aria-label="Close recipe"
            disabled={busy}
            onClick={() => select(null)}
            style={{ width: 36, height: 36, flexShrink: 0, border: '1px solid var(--line)', borderRadius: '50%', background: 'transparent', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <Icon d={ICONS.x} size={16} />
          </button>
        )}
      </div>

      <fieldset disabled={busy} style={{ border: 0, padding: phone ? 16 : '18px 20px', margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {editor.status === 'estimated' && (
          <div style={{ background: 'var(--amber-tint, #fbf3e2)', borderRadius: 12, padding: '12px 14px', fontSize: 13, lineHeight: 1.5 }}>
            OptiMenu estimated this recipe from the menu. It isn’t used for costs yet. Check the amounts with the kitchen, then confirm to put it in use.
          </div>
        )}

        {editor.status === 'skeleton' && (
          <div style={{ background: 'var(--panel)', borderRadius: 12, padding: '12px 14px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>
            Built from your menu{editor.description ? `: “${editor.description}”` : ''}. Every amount is blank. Fill them in, then confirm.
          </div>
        )}

        {admin && data.holds?.[editor.id] && (
          <div style={{ background: 'var(--amber-tint, #fbf3e2)', borderRadius: 12, padding: '12px 14px', fontSize: 13, lineHeight: 1.5 }}>
            From the owner’s upload. Not in use yet: {data.holds[editor.id]}
          </div>
        )}

        <label style={label}>
          Name
          <input style={field} value={editor.name} onChange={e => edit({ name: e.target.value })} />
        </label>

        {editor.kind === 'prep' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
            <label style={label}>
              Finished yield
              <input
                style={{ ...field, fontFamily: MONO }}
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={editor.draft.yield_quantity}
                onChange={e => editDefinition({ yield_quantity: e.target.value })}
              />
            </label>
            <div style={label}>
              Unit
              <Picker
                ariaLabel="Yield unit"
                value={editor.draft.yield_unit}
                text={editor.draft.yield_unit}
                options={unitOptions(editor.draft.yield_unit)}
                search={false}
                onChange={value => editDefinition({ yield_unit: value })}
              />
            </div>
          </div>
        )}

        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>
          {editor.kind === 'prep'
            ? 'Enter everything that goes into one whole batch, and what it weighs once it’s made. Dishes then use a portion of the finished batch.'
            : 'Enter the amounts for one served dish. For a batch prep, enter the portion of the finished batch that goes on the plate.'}
        </div>

        <div style={{ border: '1px solid var(--line)', borderRadius: 10 }}>
          {!phone && (
            <div style={{ display: 'grid', gridTemplateColumns: lineCols, gap: 10, padding: '8px 14px', background: 'var(--panel)', borderRadius: '10px 10px 0 0', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>
              <span>INGREDIENT OR BATCH</span><span>QTY</span><span>UNIT</span>{editor.kind !== 'prep' && <span>PART OF THE PLATE</span>}<span />
            </div>
          )}

          {editor.draft.lines.map((line, index) => {
            const prep = line.prep_id ? prepFor(line.prep_id) : null;
            const prepDef = prep ? (prep.published || prep.draft) : null;
            const picker = (
              <Picker
                ariaLabel={`Line ${index + 1} ingredient`}
                value={line.prep_id ? `p:${line.prep_id}` : line.ingredient_id ? `i:${line.ingredient_id}` : ''}
                text={line.name}
                placeholder="Choose or type an ingredient"
                options={[
                  ...preps.filter(n => n.id !== editor.id).map(n => ({
                    value: `p:${n.id}`,
                    label: n.name,
                    meta: n.published ? 'batch' : 'confirm first',
                    group: 'Batch preps',
                  })),
                  ...data.ingredients.map(i => ({
                    value: `i:${i.id}`,
                    label: i.name,
                    meta: i.unit,
                    group: 'Ingredients',
                  })),
                ]}
                onChange={value => {
                  const [type, id] = value.split(':');
                  const found = type === 'p'
                    ? nodes.find(n => n.id === id)
                    : data.ingredients.find(n => n.id === id);

                  lineChange(index, {
                    prep_id: type === 'p' ? id : null,
                    ingredient_id: type === 'i' ? id : null,
                    name: found?.name || '',
                    unit: type === 'p'
                      ? found.published?.yield_unit || found.draft.yield_unit
                      : found?.unit || 'oz',
                    component: type === 'p' ? found.name : line.component,
                  });
                }}
                onCreate={name => lineChange(index, { prep_id: null, ingredient_id: null, name })}
              />
            );
            const qty = (
              <input
                style={{
                  ...field,
                  fontFamily: MONO,
                  ...(editor.status === 'skeleton' && (line.quantity === '' || line.quantity == null)
                    ? { border: '1px solid var(--amber)', background: 'var(--amber-tint, #fbf3e2)' }
                    : {}),
                }}
                placeholder={editor.status === 'skeleton' ? 'Amount' : undefined}
                aria-label={`${line.name || 'Line'} quantity`}
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={line.quantity}
                onChange={e => lineChange(index, { quantity: e.target.value })}
              />
            );
            const unit = (
              <Picker
                ariaLabel={`${line.name || 'Line'} unit`}
                value={line.unit}
                text={line.unit}
                options={unitOptions(line.unit)}
                search={false}
                onChange={value => lineChange(index, { unit: value })}
              />
            );
            // Which part of the plate this belongs to. Batch preps don't need it.
            const component = editor.kind !== 'prep' && (
              <input
                style={field}
                aria-label={`${line.name || 'Line'} part of the plate`}
                placeholder="Protein, side, sauce…"
                value={line.component === 'Recipe' ? '' : line.component || ''}
                onChange={e => lineChange(index, { component: e.target.value })}
              />
            );
            const remove = (
              <button
                type="button"
                aria-label={`Remove ${line.name || 'line'}`}
                onClick={() => editDefinition({ lines: editor.draft.lines.filter((_, i) => i !== index) })}
                style={{ width: 36, height: 36, border: '1px solid var(--line)', borderRadius: '50%', background: 'transparent', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <Icon d={ICONS.x} size={14} />
              </button>
            );
            const batchNote = prep && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
                <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', borderRadius: 5, padding: '2px 6px', background: 'var(--accent-tint)', color: 'var(--accent-deep)' }}>BATCH</span>
                {prepDef?.yield_quantity
                  ? `Portion of a ${prepDef.yield_quantity} ${prepDef.yield_unit} finished batch`
                  : 'Set this batch’s finished yield first'}
              </div>
            );

            return phone ? (
              <div key={index} style={{ padding: 12, borderTop: index ? '1px solid var(--line-soft)' : 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>{picker}{batchNote}</div>
                  {remove}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{qty}{unit}</div>
                {component}
              </div>
            ) : (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: lineCols, gap: 10, padding: '8px 14px', borderTop: '1px solid var(--line-soft)', alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>{picker}{batchNote}</div>
                {qty}
                {unit}
                {component}
                {remove}
              </div>
            );
          })}

          {!editor.draft.lines.length && (
            <div style={{ padding: '14px', fontSize: 13, color: 'var(--muted)', borderTop: phone ? 0 : '1px solid var(--line-soft)' }}>
              No ingredients yet.
            </div>
          )}

          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line-soft)' }}>
            <button
              type="button"
              style={button}
              onClick={() => editDefinition({
                lines: [
                  ...editor.draft.lines,
                  { name: '', quantity: '', unit: 'oz', component: '' },
                ],
              })}
            >
              <Icon d={ICONS.plus} size={14} />
              Ingredient or batch prep
            </button>
          </div>
        </div>

        <label style={label}>
          Notes for the kitchen
          <textarea
            style={{ ...field, minHeight: 72, padding: '10px 12px', resize: 'vertical' }}
            value={editor.notes || ''}
            onChange={e => edit({ notes: e.target.value })}
          />
        </label>

        {!editor.published?.lines?.length && editor.kind === 'dish' && editor.status !== 'confirmed' && (
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)', background: 'var(--panel)', borderRadius: 10, padding: '10px 12px' }}>
            Drafts don’t change your costs. Confirm the recipe to start using it.
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          {editor.kind === 'dish' && editor.id ? (
            <button
              type="button"
              onClick={() => run(async () => {
                if (!window.confirm('Replace this draft and its batch links with the saved dish recipe?')) return;
                await post({ action: 'refresh', id: editor.id });
                setDirty(false);
              })}
              style={{ border: 0, background: 'none', padding: 0, font: "700 13px 'Manrope', sans-serif", color: 'var(--accent-deep)', cursor: 'pointer' }}
            >
              Reload the saved recipe
            </button>
          ) : <span />}
          <div style={{ display: 'flex', gap: 8, flex: phone ? '1 1 100%' : '0 0 auto' }}>
            <button type="button" style={{ ...button, flex: phone ? 1 : '0 0 auto', minHeight: 44 }} onClick={() => run(() => save(false))}>
              Save draft
            </button>
            <button type="button" style={{ ...primary, flex: phone ? 1.4 : '0 0 auto', minHeight: 44 }} onClick={() => run(() => save(true))}>
              {editor.kind === 'prep' ? 'Confirm batch' : 'Confirm recipe'}
            </button>
          </div>
        </div>
      </fieldset>
    </section>
  );

  // Start blank: a dish with nothing on it opens the step-by-step builder.
  const building = !!editor
    && editor.kind === 'dish'
    && !!editor.id
    && data.state.build === 'blank'
    && !editor.draft.lines.length
    && !editor.published;

  const builderPanel = building && (
    <RecipeBuilder
      key={editor.id}
      dish={editor}
      nodes={nodes}
      ingredients={data.ingredients}
      busy={busy}
      phone={phone}
      onDirty={() => setDirty(true)}
      onSavePrep={savePrep}
      onSave={(lines, confirm) => run(() => save(confirm, { ...editor, draft: { ...editor.draft, lines } }))}
      onClose={() => select(null)}
    />
  );

  return (
    <div style={{ color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: phone ? 14 : 18, minWidth: 0 }}>
      {phone && editor ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => select(null)}
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 2, minHeight: 40, padding: 0, border: 0, background: 'none', font: "700 14px 'Manrope', sans-serif", color: 'var(--accent-deep)', cursor: 'pointer' }}
        >
          <Icon d={ICONS.back} />
          {tab === 'prep' ? 'Batch preps' : 'Dishes'}
        </button>
      ) : (
        <>
          {showHeading && (
            <div>
              <div style={kicker}>Restaurant setup</div>
              <h2 style={{ margin: '6px 0 0', fontSize: phone ? 23 : 24, fontWeight: 700, letterSpacing: '-0.03em' }}>Recipes &amp; prep</h2>
              <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--muted)', maxWidth: 720 }}>
                Tell us what goes into each dish. Start with anything your kitchen makes in batches, then build each plate from those.
              </p>
            </div>
          )}

          <section style={{ ...card, padding: phone ? 14 : '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>
                {withRecipe} of {dishes.length} {dishes.length === 1 ? 'dish has' : 'dishes have'} a recipe
              </h3>
              <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                {preps.length} BATCH {preps.length === 1 ? 'PREP' : 'PREPS'}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--line-soft)', overflow: 'hidden', display: 'flex' }}>
              {parts.map(([name, n, color]) => (
                <span key={name} style={{ width: `${(n / Math.max(dishes.length, 1)) * 100}%`, background: color }} />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>
              {parts.map(([name, n, color]) => (
                <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                  {name} {n}
                </span>
              ))}
            </div>
          </section>

          {!hideMethods && (<>
          <div role="radiogroup" aria-label="How do you want to add recipes?" style={{ display: 'grid', gridTemplateColumns: phone ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            {methods.map(([key, title, detail]) => {
              const on = data.state.method === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={busy || dirty}
                  onClick={() => run(() => choose(key))}
                  style={{ ...card, display: 'flex', alignItems: 'flex-start', gap: 12, padding: phone ? '12px 14px' : '14px 16px', textAlign: 'left', cursor: 'pointer', color: 'var(--text)', font: 'inherit', border: `${on ? 1.5 : 1}px solid ${on ? 'var(--accent)' : 'var(--line)'}` }}
                >
                  <span style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--accent-tint)' : 'var(--panel)', color: on ? 'var(--accent-deep)' : 'var(--muted)' }}>
                    <Icon d={ICONS[key]} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{title}</span>
                    <span style={{ display: 'block', marginTop: 3, fontSize: 12.5, lineHeight: 1.45, color: 'var(--muted)' }}>{detail}</span>
                  </span>
                  {on && (
                    <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: 'var(--accent-deep)', color: 'var(--on-accent, #ffffff)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon d={ICONS.check} size={12} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: phone ? -6 : -10, fontSize: 12.5, color: 'var(--muted)' }}>
            You can mix methods. Recipes you’ve confirmed are never replaced.
          </div>
          </>)}

          {data.state.assistance === 'requested' && (admin || method === 'assisted') && (admin ? (
            <section style={{ background: 'var(--paper)', color: 'var(--ink)', borderRadius: 4, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 1px 1px rgba(17,24,25,0.05), 0 3px 6px rgba(17,24,25,0.07)' }}>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', fontWeight: 600, color: 'var(--accent-deep)' }}>KITCHEN FOLLOW-UP REQUESTED</div>
              <div style={{ fontFamily: MONO, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
                {data.draftLeft
                  ? `${data.draftLeft} ${data.draftLeft === 1 ? 'dish still needs' : 'dishes still need'} a draft. Review the estimates with the kitchen, then mark this done.`
                  : 'Every dish has a draft. Review the estimates with the kitchen, then mark this done.'}
              </div>
              <button type="button" style={{ ...button, alignSelf: 'flex-start', marginTop: 4 }} disabled={busy || dirty} onClick={() => run(() => post({ action: 'complete' }))}>
                Mark kitchen follow-up done
              </button>
            </section>
          ) : (
            <section style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: phone ? 14 : '16px 18px', borderRadius: 12, background: 'var(--accent-tint)' }}>
              <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--shell)', color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon d={ICONS.check} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                  {progressive ? 'You’re all set. Keep going.' : 'OptiMenu is on your recipes'}
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--muted)' }}>
                  {uploadDone
                    ? 'OptiMenu will check the recipes you uploaded and draft the missing ones in the background.'
                    : 'OptiMenu is drafting recipes for your dishes in the background.'}
                  {' '}We’ll reach out to book a short setup call to go over them with your kitchen. Those dishes stay off your costs until we’ve confirmed them with you.
                </p>
              </div>
            </section>
          ))}

          {method === 'manual' && !data.state.build && (
            <section style={{ ...card, padding: phone ? 14 : '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>How do you want to start?</div>
              <div style={{ display: 'grid', gridTemplateColumns: phone ? '1fr' : '1fr 1fr', gap: 10 }}>
                {[
                  ['skeleton', 'Start from your menu', 'OptiMenu lists each dish’s components and the ingredients it can read from your menu or safely assume. You fill in every amount.'],
                  ['blank', 'Start blank', 'Pick a dish and build it step by step: batch preps, then components, then the recipe for each component.'],
                ].map(([key, title, detail]) => (
                  <button
                    key={key}
                    type="button"
                    disabled={busy || dirty}
                    onClick={() => run(() => choose('manual', key))}
                    style={{ ...card, textAlign: 'left', padding: '14px 16px', cursor: 'pointer', color: 'var(--text)', font: 'inherit' }}
                  >
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{title}</span>
                    <span style={{ display: 'block', marginTop: 3, fontSize: 12.5, lineHeight: 1.45, color: 'var(--muted)' }}>{detail}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {admin && method === 'assisted' && !busy && data.draftLeft > 0 && (
            <button type="button" style={{ ...primary, alignSelf: 'flex-start' }} disabled={dirty} onClick={() => run(generate)}>
              Draft the {data.draftLeft} remaining {data.draftLeft === 1 ? 'dish' : 'dishes'}
            </button>
          )}

          {method === 'manual' && data.state.build === 'skeleton' && !busy && data.skeletonLeft > 0 && (
            <button type="button" style={{ ...primary, alignSelf: 'flex-start' }} disabled={dirty} onClick={() => run(buildSkeletons)}>
              Finish reading your menu ({data.skeletonLeft} left)
            </button>
          )}

          {method === 'upload' && uploadDone && (
            <section style={{ ...card, padding: phone ? 14 : '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: missing.length ? 'var(--amber-tint, #fbf3e2)' : 'var(--green-tint, #e9f5ec)', color: missing.length ? 'var(--amber)' : 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon d={ICONS.check} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                    {missing.length
                      ? `Upload worked, but ${missing.length} ${missing.length === 1 ? 'dish is' : 'dishes are'} still missing a recipe`
                      : 'Upload worked. Every dish has a recipe.'}
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--muted)' }}>
                    Your recipes are in use now. OptiMenu will check what we read and go over it with your kitchen on a short setup call. You don’t need to review anything now.
                  </p>
                </div>
              </div>

              {missing.length > 0 && (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {missing.map(n => (
                      <span key={n.id} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 28, padding: '0 10px', borderRadius: 14, background: 'var(--panel)', fontSize: 12.5, fontWeight: 600 }}>
                        {n.name}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>How do you want to add the rest?</div>
                  <div style={{ display: 'grid', gridTemplateColumns: phone ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                    <label style={{ ...button, position: 'relative', cursor: busy || dirty ? 'default' : 'pointer' }}>
                      <Icon d={ICONS.upload} size={15} />
                      Upload more recipes
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv"
                        disabled={busy || dirty}
                        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                        onChange={event => {
                          const file = event.target.files[0];
                          event.target.value = '';
                          run(() => upload(file));
                        }}
                      />
                    </label>
                    <button type="button" style={button} disabled={busy || dirty} onClick={() => run(() => choose('assisted'))}>
                      <Icon d={ICONS.assisted} size={15} />
                      Work with OptiMenu on the rest
                    </button>
                    <button type="button" style={button} disabled={busy || dirty} onClick={() => run(() => choose('manual'))}>
                      <Icon d={ICONS.manual} size={15} />
                      Build the rest myself
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {data.state.method === 'upload' && (
            <section style={card}>
              <label style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: busy || dirty ? 'default' : 'pointer', borderBottom: data.state.imports.length ? '1px solid var(--line-soft)' : 0 }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-tint)', color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon d={ICONS.upload} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>
                    {data.state.imports.length ? 'Upload another document' : 'Upload a recipe document'}
                  </span>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--muted)' }}>PDF, photo, CSV or text, up to 20 MB</span>
                </span>
                <span style={button}>Choose file</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv"
                  disabled={busy || dirty}
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                  onChange={event => {
                    const file = event.target.files[0];
                    event.target.value = '';
                    run(() => upload(file));
                  }}
                />
              </label>

              {data.state.imports.map((file, fileIndex) => {
                const waiting = (file.items || []).filter(item => !item.adopted);
                const saved = (file.items || []).filter(item => item.adopted);
                const summary = file.summary;

                return (
                  <div key={file.path} style={{ borderTop: fileIndex ? '1px solid var(--line-soft)' : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
                      <span style={{ color: 'var(--accent-deep)', display: 'flex' }}><Icon d={ICONS.doc} /></span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</span>
                        <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--muted)' }}>
                          {file.parsed
                            ? `${(file.items || []).length} ${(file.items || []).length === 1 ? 'RECIPE' : 'RECIPES'} FOUND${saved.length ? ` · ${saved.length} SAVED AS DRAFTS` : ''}`
                            : busy ? 'READING…' : 'NOT READ YET'}
                        </span>
                      </span>
                      {!file.parsed && !busy && (
                        <button type="button" style={button} disabled={busy || dirty} onClick={() => run(() => post({ action: 'import', path: file.path, name: file.name }))}>
                          Try reading again
                        </button>
                      )}
                    </div>

                    {summary && !progressive && (
                      <div style={{ display: 'grid', gridTemplateColumns: phone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', borderTop: '1px solid var(--line-soft)' }}>
                        {[
                          ['BATCH PREPS ADDED', summary.preps, false],
                          ['DISHES MATCHED BY NAME', summary.dishes, false],
                          ['BATCH LINES LINKED', summary.linked, false],
                          ['NEED AN AMOUNT OR YIELD', summary.review, true],
                        ].map(([k, v, warn]) => (
                          <div key={k} style={{ padding: '10px 16px' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: warn && v ? 'var(--amber)' : 'var(--text)' }}>{v}</div>
                            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--muted)' }}>{k}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {!progressive && waiting.length > 0 && (
                      <div style={{ padding: '10px 16px 0', borderTop: '1px solid var(--line-soft)', fontSize: 12.5, color: 'var(--muted)' }}>
                        {waiting.length === 1 ? 'This one didn’t' : 'These didn’t'} match a dish by name. Choose where each one goes.
                      </div>
                    )}

                    {!progressive && waiting.map(item => (
                      <div key={item.id} style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{item.name}</div>
                        {item.notes && <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--muted)' }}>{item.notes}</div>}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <Picker
                            style={{ flex: '1 1 220px' }}
                            ariaLabel={`Save ${item.name} to`}
                            disabled={busy || dirty}
                            value={targets[item.id] || ''}
                            placeholder="Save this recipe to…"
                            options={[
                              { value: 'new-prep', label: 'A new batch prep', group: 'New' },
                              ...dishes.map(node => ({
                                value: node.id,
                                label: node.name,
                                group: 'Dishes',
                                meta: node.status === 'confirmed' ? 'confirmed' : '',
                              })),
                              ...preps.map(node => ({ value: node.id, label: node.name, group: 'Batch preps' })),
                            ]}
                            onChange={value => setTargets({ ...targets, [item.id]: value })}
                          />
                          <button
                            type="button"
                            style={primary}
                            disabled={busy || dirty || !targets[item.id]}
                            onClick={() => run(async () => {
                              const target = nodes.find(n => n.id === targets[item.id]);

                              if (
                                target?.draft.lines.length &&
                                !window.confirm('Replace this saved draft with the uploaded recipe? The active recipe stays unchanged until confirmation.')
                              ) return;

                              await post({
                                action: 'adopt',
                                path: file.path,
                                item_id: item.id,
                                target: targets[item.id],
                                replace: true,
                              });
                            })}
                          >
                            Save as draft
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}

      {(message || error || busy) && (
        <div role="status" aria-live="polite" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 13, lineHeight: 1.5, borderRadius: 10, padding: '10px 12px', background: error ? 'var(--red-tint, #fbeceb)' : 'var(--accent-tint)', color: error ? 'var(--red)' : 'var(--text)' }}>
          <span style={{ flex: 1, minWidth: 0 }}>{error || message || 'Working…'}</span>
          {busy && looping && (
            <button type="button" style={button} onClick={() => { stop.current = true; }}>
              Stop after this batch
            </button>
          )}
        </div>
      )}

      {showWork && (phone ? (
        editor ? (builderPanel || editorPanel) : list
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
          {list}
          {builderPanel || editorPanel || (
            <section style={{ ...card, border: '1px dashed var(--line)', padding: 28, textAlign: 'center', fontSize: 13.5, color: 'var(--muted)' }}>
              Choose a {tab === 'prep' ? 'batch prep' : 'dish'} to see and edit its recipe.
            </section>
          )}
        </div>
      ))}

      <LeaveGuardModal
        open={!!guard.pendingUrl}
        title="Recipe changes are not saved"
        body="Save this draft or wait for the current operation before leaving."
        onStay={guard.stay}
        onLeave={guard.leave}
      />
    </div>
  );
}