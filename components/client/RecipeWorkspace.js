import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import useIsPhone from '../../lib/admin/useIsPhone';
import { UNITS } from '../../lib/recipes/compile';
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

const field = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  minHeight: 44,
  padding: '10px 12px',
  border: '1px solid var(--line)',
  borderRadius: 10,
  background: 'var(--shell)',
  color: 'var(--text)',
  fontSize: 16,
};

const button = {
  minHeight: 44,
  padding: '10px 16px',
  border: '1px solid var(--line)',
  borderRadius: 24,
  background: 'var(--shell)',
  color: 'var(--text)',
  fontWeight: 700,
  cursor: 'pointer',
};

const card = {
  padding: 16,
  border: '1px solid var(--line)',
  borderRadius: 14,
  background: 'var(--shell)',
  minWidth: 0,
};

export default function RecipeWorkspace({
  restaurantId,
  admin = false,
  onBusyChange,
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
  const [tab, setTab] = useState('prep');
  const [editor, setEditor] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [targets, setTargets] = useState({});
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
    }
  }, [data, router.query.recipe, dirty, busy]);

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

  async function generate() {
    stop.current = false;

    while (latest.current.remaining > 0 && !stop.current) {
      setMessage(
        `${latest.current.remaining} dishes still need a draft…`
      );
      await post({ action: 'assist' });
    }

    setMessage(
      stop.current
        ? 'Progress saved. You can resume later.'
        : 'Drafts saved. Estimated recipes are active and awaiting kitchen confirmation.'
    );
  }

  async function choose(method) {
    if (dirty) {
      setError('Save this recipe draft before changing setup methods.');
      return;
    }

    await post({ action: 'method', method });

    if (method === 'assisted') {
      await generate();
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

    await post({
      action: 'import',
      path: signed.path,
      name: file.name,
    });

    setMessage(
      'Recipes extracted. Assign each one to a batch or dish, then check quantities.'
    );
  }

  async function save(confirm) {
    const result = await post({
      action: confirm ? 'confirm' : 'save',
      node: editor,
    });

    const saved = result.state.nodes.find(n => n.id === editor.id)
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
        ? 'Recipe confirmed. Calculations are queued.'
        : 'Draft saved. The active recipe is unchanged.'
    );
  }

  if (!data) {
    return <div role="status">{error || 'Loading recipes…'}</div>;
  }

  const nodes = data.state.nodes;

  const units = value => (
    <>
      {!UNITS.includes(value) && (
        <option value={value}>{value || 'Choose unit'}</option>
      )}
      {UNITS.map(unit => <option key={unit}>{unit}</option>)}
    </>
  );

  return (
    <div style={{ color: 'var(--text)' }}>
      <h2 style={{ margin: '0 0 8px' }}>Recipes &amp; prep</h2>

      <p style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
        Start with what your kitchen makes in batches. Then tell us how
        much goes into each dish. Save now and finish later from your profile.
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: phone
          ? '1fr'
          : 'repeat(3,minmax(0,1fr))',
        gap: 10,
        marginBottom: 16,
      }}>
        {[
          ['upload', 'Upload recipes', 'PDFs, photos or text files'],
          ['assisted', 'Work with OptiMenu', 'Draft recipes and kitchen follow-up'],
          ['manual', 'Build them myself', 'Batch preps, then dishes'],
        ].map(([key, label, detail]) => (
          <button
            key={key}
            disabled={busy || dirty}
            onClick={() => run(() => choose(key))}
            style={{
              ...card,
              textAlign: 'left',
              color: 'var(--text)',
              cursor: 'pointer',
              borderColor: data.state.method === key
                ? 'var(--accent)'
                : 'var(--line)',
            }}
          >
            <strong>{label}</strong>
            <div style={{ marginTop: 5, color: 'var(--muted)' }}>
              {detail}
            </div>
          </button>
        ))}
      </div>

      {data.state.assistance === 'requested' && (
        <p>
          Kitchen follow-up requested. OptiMenu can review these same
          recipes with you.
        </p>
      )}

      <div role="status" aria-live="polite">{message}</div>
      {error && <p role="alert">{error}</p>}

      {busy && (
        <p>
          Working…{' '}
          <button
            style={button}
            onClick={() => { stop.current = true; }}
          >
            Stop after this batch
          </button>
        </p>
      )}

      {data.state.method === 'assisted' &&
        !busy &&
        data.remaining > 0 && (
          <button
            style={button}
            disabled={dirty}
            onClick={() => run(generate)}
          >
            Resume recipe drafts ({data.remaining})
          </button>
        )}

      {data.state.method === 'upload' && (
        <div style={{ ...card, margin: '16px 0' }}>
          <label>
            Upload a recipe document (up to 20 MB)
            <input
              style={{ ...field, marginTop: 8 }}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv"
              disabled={busy || dirty}
              onChange={event => {
                const file = event.target.files[0];
                event.target.value = '';
                run(() => upload(file));
              }}
            />
          </label>

          {data.state.imports.map(file => (
            <div key={file.path}>
              <p><strong>{file.name}</strong></p>

              {!file.parsed && (
                <button
                  style={button}
                  disabled={busy || dirty}
                  onClick={() => run(() => post({
                    action: 'import',
                    path: file.path,
                    name: file.name,
                  }))}
                >
                  Read uploaded document
                </button>
              )}

              {(file.items || [])
                .filter(item => !item.adopted)
                .map(item => (
                  <div
                    key={item.id}
                    style={{ ...card, marginTop: 8 }}
                  >
                    <strong>{item.name}</strong>
                    <p>{item.notes}</p>

                    <select
                      style={field}
                      disabled={busy || dirty}
                      value={targets[item.id] || ''}
                      onChange={e => setTargets({
                        ...targets,
                        [item.id]: e.target.value,
                      })}
                    >
                      <option value="">Save this recipe to…</option>
                      <option value="new-prep">A new batch prep</option>

                      {nodes.map(node => (
                        <option key={node.id} value={node.id}>
                          {node.kind === 'prep' ? 'Batch: ' : 'Dish: '}
                          {node.name}
                        </option>
                      ))}
                    </select>

                    <button
                      style={{ ...button, marginTop: 8 }}
                      disabled={busy || dirty || !targets[item.id]}
                      onClick={() => run(async () => {
                        const target = nodes.find(
                          n => n.id === targets[item.id]
                        );

                        if (
                          target?.draft.lines.length &&
                          !window.confirm(
                            'Replace this saved draft with the uploaded recipe? The active recipe stays unchanged until confirmation.'
                          )
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
                ))}
            </div>
          ))}
        </div>
      )}

      <div style={{
        display: 'flex',
        gap: 8,
        margin: '18px 0',
        overflowX: 'auto',
      }}>
        {[
          ['prep', 'Batch preps'],
          ['dish', 'Dishes'],
        ].map(([key, label]) => (
          <button
            key={key}
            style={{
              ...button,
              background: tab === key
                ? 'var(--accent-tint)'
                : 'var(--shell)',
            }}
            disabled={busy}
            onClick={() => {
              if (
                dirty &&
                !window.confirm('Discard unsaved changes?')
              ) return;

              setDirty(false);
              setEditor(null);
              setTab(key);

              const query = { ...router.query };
              delete query.recipe;

              router.push(
                { pathname: router.pathname, query },
                undefined,
                { shallow: true, scroll: false }
              );
            }}
          >
            {label} ({nodes.filter(n => n.kind === key).length})
          </button>
        ))}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: phone
          ? '1fr'
          : 'minmax(200px,1fr) minmax(0,2fr)',
        gap: 16,
        alignItems: 'start',
      }}>
        {(!phone || !editor) && (
          <div style={{ display: 'grid', gap: 8 }}>
            {tab === 'prep' && (
              <button
                style={button}
                disabled={busy}
                onClick={() => select({
                  kind: 'prep',
                  name: '',
                  notes: '',
                  draft: blank(),
                })}
              >
                + Add a batch prep
              </button>
            )}

            {nodes.filter(n => n.kind === tab).map(node => (
              <button
                key={node.id}
                disabled={busy}
                style={{
                  ...card,
                  textAlign: 'left',
                  color: 'var(--text)',
                  borderColor: editor?.id === node.id
                    ? 'var(--accent)'
                    : 'var(--line)',
                }}
                onClick={() => select(node)}
              >
                <strong>{node.name}</strong>
                <div style={{
                  color: 'var(--muted)',
                  marginTop: 4,
                }}>
                  {node.status}
                  {node.status === 'draft' && node.published
                    ? ' · previous recipe still active'
                    : ''}
                </div>
              </button>
            ))}

            {!nodes.some(n => n.kind === tab) && (
              <p>
                {tab === 'prep'
                  ? 'Add salsa, sauces, mashed potatoes or anything prepared in a batch.'
                  : 'Upload your menu first to populate the dish list.'}
              </p>
            )}
          </div>
        )}

        {editor && (
          <section style={card}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              alignItems: 'center',
            }}>
              <h3 style={{ margin: 0 }}>
                {editor.kind === 'prep' ? 'Batch recipe' : 'Dish recipe'}
              </h3>

              <button
                style={button}
                disabled={busy}
                aria-label="Close recipe"
                onClick={() => select(null)}
              >
                ×
              </button>
            </div>

            <fieldset
              disabled={busy}
              style={{
                border: 0,
                padding: 0,
                margin: 0,
                minWidth: 0,
              }}
            >
              <label style={{ display: 'block', marginTop: 14 }}>
                Name
                <input
                  style={field}
                  value={editor.name}
                  onChange={e => edit({ name: e.target.value })}
                />
              </label>

              {editor.kind === 'prep' && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
                  gap: 10,
                  marginTop: 14,
                }}>
                  <label>
                    Finished batch yield
                    <input
                      style={field}
                      type="number"
                      min="0"
                      step="any"
                      value={editor.draft.yield_quantity}
                      onChange={e => editDefinition({
                        yield_quantity: e.target.value,
                      })}
                    />
                  </label>

                  <label>
                    Yield unit
                    <select
                      style={field}
                      value={editor.draft.yield_unit}
                      onChange={e => editDefinition({
                        yield_unit: e.target.value,
                      })}
                    >
                      {units(editor.draft.yield_unit)}
                    </select>
                  </label>
                </div>
              )}

              <p style={{ color: 'var(--muted)' }}>
                {editor.kind === 'prep'
                  ? 'Enter the ingredients for the whole batch and its actual finished yield after cooking.'
                  : 'Enter quantities for one served dish. A batch line is the portion served from that prep.'}
              </p>

              {editor.draft.lines.map((line, index) => (
                <div
                  key={index}
                  style={{
                    ...card,
                    marginBottom: 10,
                    padding: 12,
                  }}
                >
                  <label>
                    Ingredient or batch
                    <select
                      style={field}
                      value={
                        line.prep_id
                          ? `p:${line.prep_id}`
                          : line.ingredient_id
                            ? `i:${line.ingredient_id}`
                            : ''
                      }
                      onChange={e => {
                        const [type, id] = e.target.value.split(':');

                        const found = type === 'p'
                          ? nodes.find(n => n.id === id)
                          : data.ingredients.find(n => n.id === id);

                        lineChange(index, {
                          prep_id: type === 'p' ? id : null,
                          ingredient_id: type === 'i' ? id : null,
                          name: found?.name || '',
                          unit: type === 'p'
                            ? found.published?.yield_unit ||
                              found.draft.yield_unit
                            : found?.unit || 'oz',
                          component: type === 'p'
                            ? found.name
                            : line.component,
                        });
                      }}
                    >
                      <option value="">Ingredient by name</option>

                      <optgroup label="Batch preps">
                        {nodes
                          .filter(
                            n =>
                              n.kind === 'prep' &&
                              n.id !== editor.id
                          )
                          .map(n => (
                            <option key={n.id} value={`p:${n.id}`}>
                              {n.name}
                              {!n.published ? ' (confirm first)' : ''}
                            </option>
                          ))}
                      </optgroup>

                      <optgroup label="Ingredients">
                        {data.ingredients.map(i => (
                          <option key={i.id} value={`i:${i.id}`}>
                            {i.name} · {i.unit}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </label>

                  {!line.prep_id && !line.ingredient_id && (
                    <label>
                      Name
                      <input
                        style={{ ...field, marginTop: 6 }}
                        value={line.name}
                        onChange={e => lineChange(index, {
                          name: e.target.value,
                        })}
                      />
                    </label>
                  )}

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
                    gap: 10,
                    marginTop: 10,
                  }}>
                    <label>
                      Quantity
                      <input
                        style={field}
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantity}
                        onChange={e => lineChange(index, {
                          quantity: e.target.value,
                        })}
                      />
                    </label>

                    <label>
                      Unit
                      <select
                        style={field}
                        value={line.unit}
                        onChange={e => lineChange(index, {
                          unit: e.target.value,
                        })}
                      >
                        {units(line.unit)}
                      </select>
                    </label>
                  </div>

                  <label style={{ display: 'block', marginTop: 10 }}>
                    Component (such as Sauce or Protein)
                    <input
                      style={field}
                      value={line.component}
                      onChange={e => lineChange(index, {
                        component: e.target.value,
                      })}
                    />
                  </label>

                  <button
                    style={{ ...button, marginTop: 8 }}
                    onClick={() => editDefinition({
                      lines: editor.draft.lines.filter(
                        (_, i) => i !== index
                      ),
                    })}
                  >
                    Remove ingredient
                  </button>
                </div>
              ))}

              <button
                style={button}
                onClick={() => editDefinition({
                  lines: [
                    ...editor.draft.lines,
                    {
                      name: '',
                      quantity: '',
                      unit: 'oz',
                      component: 'Recipe',
                    },
                  ],
                })}
              >
                + Ingredient or batch
              </button>

              <label style={{ display: 'block', marginTop: 14 }}>
                Notes / assumptions
                <textarea
                  style={{ ...field, minHeight: 90 }}
                  value={editor.notes || ''}
                  onChange={e => edit({ notes: e.target.value })}
                />
              </label>

              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginTop: 14,
              }}>
                <button
                  style={button}
                  onClick={() => run(() => save(false))}
                >
                  Save draft
                </button>

                <button
                  style={{
                    ...button,
                    background: 'var(--accent-tint)',
                    color: 'var(--accent-deep)',
                  }}
                  onClick={() => run(() => save(true))}
                >
                  Confirm recipe
                </button>
              </div>

              {editor.kind === 'dish' && (
                <button
                  style={{ ...button, marginTop: 12 }}
                  onClick={() => run(async () => {
                    if (!window.confirm(
                      'Replace this builder draft and its batch links with the current saved dish recipe?'
                    )) return;

                    await post({
                      action: 'refresh',
                      id: editor.id,
                    });
                    setDirty(false);
                  })}
                >
                  Reload current dish recipe
                </button>
              )}
            </fieldset>
          </section>
        )}
      </div>

      {admin && data.state.assistance === 'requested' && (
        <button
          style={{ ...button, marginTop: 20 }}
          disabled={busy || dirty}
          onClick={() => run(() => post({ action: 'complete' }))}
        >
          Mark kitchen follow-up complete
        </button>
      )}

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