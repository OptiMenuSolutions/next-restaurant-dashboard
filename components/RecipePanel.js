// components/RecipePanel.js
import React from 'react';

/**
 * RecipePanel
 * Renders the ingredient breakdown for a recommended dish.
 * Highlights at-risk ingredients in red.
 *
 * Props:
 *   rec       — AI recommendation object { title, description, ... }
 *   menuItems — full menu items array with component/ingredient tree
 *   wasteRisk — waste risk array from computeWasteRisk
 */
export default function RecipePanel({ rec, menuItems, wasteRisk }) {
  if (!rec) return null;

  // Find the menu item matching this recommendation by title
  const recTitleLower = (rec.title || '').toLowerCase();
  const matched = (menuItems || []).find(item =>
    item.name && (
      item.name.toLowerCase() === recTitleLower ||
      recTitleLower.includes(item.name.toLowerCase()) ||
      item.name.toLowerCase().includes(recTitleLower.split(' ')[0])
    )
  );

  // Build at-risk ingredient name set for fast lookup
  const atRiskNames = new Set(
    (wasteRisk || []).map(w => (w.name || '').toLowerCase())
  );

  const components = matched?.menu_item_components || [];

  return (
    <div style={{ padding: 'clamp(6px,.6vh,10px) clamp(8px,.7vw,12px)' }}>
      {/* Header */}
      <div style={{
        fontSize: 'clamp(8px,.6vw,10px)',
        fontWeight: 600,
        color: 'var(--text-faint)',
        textTransform: 'uppercase',
        letterSpacing: '.7px',
        marginBottom: 'clamp(5px,.5vh,8px)',
        fontFamily: 'Inter, sans-serif',
      }}>
        Recipe Breakdown
      </div>

      {/* No match found */}
      {!matched && (
        <div style={{
          fontSize: 'clamp(9px,.68vw,11px)',
          color: 'var(--text-muted)',
          fontFamily: 'Courier New, monospace',
          padding: '4px 0',
        }}>
          No recipe data found for this dish.
        </div>
      )}

      {/* Components + ingredients */}
      {components.length > 0 && components.map((comp, ci) => (
        <div key={comp.id || ci}>
          <div className="db-receipt-component">{comp.name}</div>
          {(comp.component_ingredients || []).map((ci_item, ii) => {
            const ingName = ci_item.ingredients?.name || '';
            const isAtRisk = atRiskNames.has(ingName.toLowerCase());
            const qty = ci_item.quantity != null ? ci_item.quantity : '';
            const unit = ci_item.unit || '';
            const label = [qty, unit, ingName].filter(Boolean).join(' ');
            return (
              <div
                key={ci_item.ingredients?.id || ii}
                className={`db-receipt-ingredient${isAtRisk ? ' at-risk' : ''}`}
              >
                {isAtRisk ? '⚠ ' : ''}{ label }
              </div>
            );
          })}
        </div>
      ))}

      {/* Matched item but no components */}
      {matched && components.length === 0 && (
        <div style={{
          fontSize: 'clamp(9px,.68vw,11px)',
          color: 'var(--text-muted)',
          fontFamily: 'Courier New, monospace',
          padding: '4px 0',
        }}>
          No ingredient breakdown available.
        </div>
      )}

      {/* At-risk legend */}
      {atRiskNames.size > 0 && matched && components.length > 0 && (
        <div style={{
          marginTop: 'clamp(6px,.6vh,9px)',
          paddingTop: 'clamp(4px,.4vh,6px)',
          borderTop: '1px dashed var(--border)',
          fontSize: 'clamp(7px,.55vw,9px)',
          color: 'var(--color-red)',
          fontFamily: 'Courier New, monospace',
        }}>
          ⚠ at-risk ingredients highlighted
        </div>
      )}
    </div>
  );
}