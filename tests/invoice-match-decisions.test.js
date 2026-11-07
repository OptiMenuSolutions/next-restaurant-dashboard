import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyInvoiceMatchDecisions,
} from '../lib/invoiceMatchDecisions.js';

const FLOUR_ID = 'ingredient-flour';
const SUGAR_ID = 'ingredient-sugar';
const BUTTER_ID = 'ingredient-butter';

const ingredients = [
  { id: FLOUR_ID, name: 'All-purpose flour', unit: 'oz' },
  { id: SUGAR_ID, name: 'Sugar', unit: 'oz' },
  { id: BUTTER_ID, name: 'Butter', unit: 'oz' },
];

const supplierKey = 'harborline foodservice';
const productKey = 'all purpose flour';

function createDecisions({
  approvals = [],
  rejections = [],
  supplier = supplierKey,
} = {}) {
  return {
    supplierKey: supplier,

    approvals: new Map(
      approvals.map(([product, ingredient]) => [
        JSON.stringify([supplier, product]),
        ingredient,
      ])
    ),

    rejections: new Set(
      rejections.map(([product, ingredient]) =>
        JSON.stringify([supplier, product, ingredient])
      )
    ),
  };
}

function runMatch({
  description = 'All Purpose Flour',
  invoiceUnit = 'lb',
  match = { status: 'new', matches: [] },
  decisions = createDecisions(),
  eligibleIngredients = ingredients,
} = {}) {
  return applyInvoiceMatchDecisions({
    description,
    invoiceUnit,
    ingredients: eligibleIngredients,
    match,
    decisions,
  });
}

test('1. Approved relationship automatically selects the ingredient', () => {
  const result = runMatch({
    decisions: createDecisions({
      approvals: [[productKey, FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'auto');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].id, FLOUR_ID);
  assert.equal(result.decision_source, 'admin_approved');
});

test('2. Supplier-specific approvals do not carry over to another supplier', () => {
  const result = runMatch({
    decisions: createDecisions({
      supplier: 'another supplier',
    }),
  });

  assert.equal(result.status, 'new');
  assert.equal(result.matches.length, 0);
});

test('3. Rejected ingredient is removed from matching candidates', () => {
  const result = runMatch({
    match: {
      status: 'possible',
      matches: [
        { id: FLOUR_ID, name: 'All-purpose flour' },
        { id: SUGAR_ID, name: 'Sugar' },
      ],
    },
    decisions: createDecisions({
      rejections: [[productKey, FLOUR_ID]],
    }),
  });

  assert.equal(
    result.matches.some(item => item.id === FLOUR_ID),
    false
  );

  assert.equal(
    result.matches.some(item => item.id === SUGAR_ID),
    true
  );
});

test('4. Rejection overrides an existing automatic match', () => {
  const result = runMatch({
    match: {
      status: 'auto',
      matches: [
        { id: FLOUR_ID, name: 'All-purpose flour' },
      ],
    },
    decisions: createDecisions({
      rejections: [[productKey, FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'new');
  assert.equal(result.matches.length, 0);
});

test('5. Unrelated ingredients remain eligible after a rejection', () => {
  const result = runMatch({
    match: {
      status: 'possible',
      matches: [
        { id: FLOUR_ID, name: 'All-purpose flour' },
        { id: BUTTER_ID, name: 'Butter' },
      ],
    },
    decisions: createDecisions({
      rejections: [[productKey, FLOUR_ID]],
    }),
  });

  assert.deepEqual(
    result.matches.map(item => item.id),
    [BUTTER_ID]
  );
});

test('6. Approval cannot select an ineligible restaurant ingredient', () => {
  const result = runMatch({
    decisions: createDecisions({
      approvals: [[productKey, FLOUR_ID]],
    }),
    eligibleIngredients: [
      { id: SUGAR_ID, name: 'Sugar' },
    ],
  });

  assert.notEqual(result.status, 'auto');
  assert.equal(result.matches.length, 0);
});

test('7. A rejection takes precedence over a conflicting approval', () => {
  const result = runMatch({
    decisions: createDecisions({
      approvals: [[productKey, FLOUR_ID]],
      rejections: [[productKey, FLOUR_ID]],
    }),
    match: {
      status: 'auto',
      matches: [
        { id: FLOUR_ID, name: 'All-purpose flour' },
      ],
    },
  });

  assert.equal(result.status, 'new');
  assert.equal(result.matches.length, 0);
});

test('8. Approval for another product does not apply', () => {
  const result = runMatch({
    decisions: createDecisions({
      approvals: [['brown sugar', SUGAR_ID]],
    }),
  });

  assert.equal(result.status, 'new');
  assert.equal(result.matches.length, 0);
});

test('9. An existing valid automatic match remains unchanged', () => {
  const result = runMatch({
    match: {
      status: 'auto',
      matches: [
        { id: FLOUR_ID, name: 'All-purpose flour' },
      ],
    },
  });

  assert.equal(result.status, 'auto');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].id, FLOUR_ID);
});

test('10. Weight-based invoice units are compatible', () => {
  const result = runMatch({
    invoiceUnit: 'lb',
    decisions: createDecisions({
      approvals: [[productKey, FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'auto');
  assert.equal(result.matches[0].id, FLOUR_ID);
});

test('11. Count-based invoice cannot auto-approve weight ingredient', () => {
  const result = runMatch({
    invoiceUnit: 'ct',
    decisions: createDecisions({
      approvals: [[productKey, FLOUR_ID]],
    }),
  });

  assert.notEqual(result.status, 'auto');
});

test('12. Volume-based invoice cannot auto-approve weight ingredient', () => {
  const result = runMatch({
    invoiceUnit: 'gal',
    decisions: createDecisions({
      approvals: [[productKey, FLOUR_ID]],
    }),
  });

  assert.notEqual(result.status, 'auto');
});

test('13. Unknown invoice units cannot bypass verification', () => {
  const result = runMatch({
    invoiceUnit: null,
    decisions: createDecisions({
      approvals: [[productKey, FLOUR_ID]],
    }),
  });

  assert.notEqual(result.status, 'auto');
});

test('14. Compatible volume units remain eligible', () => {
  const result = runMatch({
    invoiceUnit: 'gal',
    eligibleIngredients: [
      {
        id: FLOUR_ID,
        name: 'All Purpose Flour',
        unit: 'fl oz',
      },
    ],
    decisions: createDecisions({
      approvals: [[productKey, FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'auto');
});

test('15. Count-to-count matching remains eligible', () => {
  const result = runMatch({
    invoiceUnit: 'ct',
    eligibleIngredients: [
      {
        id: FLOUR_ID,
        name: 'All Purpose Flour',
        unit: 'each',
      },
    ],
    decisions: createDecisions({
      approvals: [[productKey, FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'auto');
});

test('16. Ordinary automatic matches cannot bypass unit compatibility', () => {
  const result = runMatch({
    invoiceUnit: 'ct',
    match: {
      status: 'auto',
      matches: [
        { id: FLOUR_ID, name: 'All-purpose flour', unit: 'oz' },
      ],
    },
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.matches.length, 1);
  assert.equal(result.decision_source, 'incompatible_units');
});

test('17. Ordinary compatible automatic matches remain valid', () => {
  const result = runMatch({
    invoiceUnit: 'lb',
    match: {
      status: 'auto',
      matches: [
        { id: FLOUR_ID, name: 'All-purpose flour', unit: 'oz' },
      ],
    },
  });

  assert.equal(result.status, 'auto');
  assert.equal(result.matches[0].id, FLOUR_ID);
});

test('18. Unverified cans cannot automatically match volume ingredients', () => {
  const result = runMatch({
    invoiceUnit: 'can',
    eligibleIngredients: [
      {
        id: FLOUR_ID,
        name: 'Test canned ingredient',
        unit: 'fl oz',
      },
    ],
    decisions: createDecisions({
      approvals: [[productKey, FLOUR_ID]],
    }),
  });

  assert.notEqual(result.status, 'auto');
});

test('19. Numbered cans require package verification', () => {
  const result = runMatch({
    invoiceUnit: '#10 can',
    eligibleIngredients: [
      {
        id: FLOUR_ID,
        name: 'Test canned ingredient',
        unit: 'fl oz',
      },
    ],
    decisions: createDecisions({
      approvals: [[productKey, FLOUR_ID]],
    }),
  });

  assert.notEqual(result.status, 'auto');
});

test('20. Case units cannot automatically authorize physical conversions', () => {
  const result = runMatch({
    invoiceUnit: 'case',
    decisions: createDecisions({
      approvals: [[productKey, FLOUR_ID]],
    }),
  });

  assert.notEqual(result.status, 'auto');
});

test('21. Ordinary automatic matches with unknown units require review', () => {
  const result = runMatch({
    invoiceUnit: null,
    match: {
      status: 'auto',
      matches: [
        { id: FLOUR_ID, name: 'All-purpose flour', unit: 'oz' },
      ],
    },
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.matches.length, 1);
  assert.equal(result.decision_source, 'incompatible_units');
});

test('22. Administrator approval cannot override identity conflict', () => {
  const result = runMatch({
    description: 'Broccoli Crowns Fresh',
    invoiceUnit: 'lb',
    eligibleIngredients: [{
      id: FLOUR_ID,
      name: 'Broccoli Florets Frozen',
      unit: 'oz',
    }],
    decisions: createDecisions({
      approvals: [['broccoli crowns fresh', FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.decision_source, 'identity_review_required');
  assert.equal(result.matches[0].id, FLOUR_ID);
});

test('23. Compatible administrator approvals remain automatic', () => {
  const result = runMatch({
    description: 'Chicken Breast BNLS SKNLS',
    invoiceUnit: 'lb',
    eligibleIngredients: [{
      id: FLOUR_ID,
      name: 'Chicken Breast Boneless Skinless',
      unit: 'oz',
    }],
    decisions: createDecisions({
      approvals: [['chicken breast bnls sknls', FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'auto');
  assert.equal(result.decision_source, 'admin_approved');
});

test('24. Ordinary automatic matches cannot bypass identity protection', () => {
  const result = runMatch({
    description: 'Broccoli Crowns Fresh',
    invoiceUnit: 'lb',
    eligibleIngredients: [{
      id: FLOUR_ID,
      name: 'Broccoli Florets Frozen',
      unit: 'oz',
    }],
    match: {
      status: 'auto',
      matches: [{
        id: FLOUR_ID,
        name: 'Broccoli Florets Frozen',
        unit: 'oz',
      }],
    },
  });

  assert.equal(result.status, 'ambiguous');
});

test('25. Ordinary compatible automatic matches remain valid', () => {
  const result = runMatch({
    description: 'Chicken Breast BNLS SKNLS',
    invoiceUnit: 'lb',
    eligibleIngredients: [{
      id: FLOUR_ID,
      name: 'Chicken Breast Boneless Skinless',
      unit: 'oz',
    }],
    match: {
      status: 'auto',
      matches: [{
        id: FLOUR_ID,
        name: 'Chicken Breast Boneless Skinless',
        unit: 'oz',
      }],
    },
  });

  assert.equal(result.status, 'auto');
});

test('26. Multiple automatic candidates require review', () => {
  const result = runMatch({
    match: {
      status: 'auto',
      matches: [
        { id: FLOUR_ID, score: 0.99 },
        { id: SUGAR_ID, score: 0.98 },
      ],
    },
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.matches.length, 2);
  assert.equal(result.decision_source, 'multiple_candidates');
});

test('27. Duplicate ingredient candidates are removed', () => {
  const result = runMatch({
    match: {
      status: 'ambiguous',
      matches: [
        { id: FLOUR_ID, score: 0.99 },
        { id: FLOUR_ID, score: 0.95 },
        { id: SUGAR_ID, score: 0.90 },
      ],
    },
  });

  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(
    result.matches.map(item => item.id),
    [FLOUR_ID, SUGAR_ID]
  );
});

test('28. Ambiguous matches never automatically select an ingredient', () => {
  const result = runMatch({
    match: {
      status: 'ambiguous',
      matches: [
        { id: FLOUR_ID, score: 0.99 },
      ],
    },
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.matches.length, 1);
});

test('29. Rejected candidates are removed without losing alternatives', () => {
  const result = runMatch({
    match: {
      status: 'ambiguous',
      matches: [
        { id: FLOUR_ID, score: 0.99 },
        { id: SUGAR_ID, score: 0.90 },
      ],
    },
    decisions: createDecisions({
      rejections: [[productKey, FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(
    result.matches.map(item => item.id),
    [SUGAR_ID]
  );
});

test('30. Candidate names must come from restaurant ingredients', () => {
  const result = runMatch({
    match: {
      status: 'ambiguous',
      matches: [{
        id: FLOUR_ID,
        name: 'Incorrect AI-provided ingredient name',
        score: 0.99,
      }],
    },
  });

  assert.equal(
    result.matches[0].name,
    'All-purpose flour'
  );
});

test('31. Incompatible automatic units preserve the review candidate', () => {
  const result = runMatch({
    invoiceUnit: 'ct',
    match: {
      status: 'auto',
      matches: [{
        id: FLOUR_ID,
        score: 0.99,
      }],
    },
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.decision_source, 'incompatible_units');
  assert.equal(result.matches[0].id, FLOUR_ID);
});

test('32. Unknown products remain new', () => {
  const result = runMatch({
    match: {
      status: 'new',
      matches: [],
    },
  });

  assert.equal(result.status, 'new');
  assert.equal(result.matches.length, 0);
});

test('33. Approved supplier alias bypasses missing descriptive details', () => {
  const result = runMatch({
    description: 'Chicken Breast Fresh',
    invoiceUnit: 'lb',
    eligibleIngredients: [{
      id: FLOUR_ID,
      name: 'Chicken breast',
      unit: 'oz',
    }],
    decisions: createDecisions({
      approvals: [['chicken breast fresh', FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'auto');
  assert.equal(result.matches[0].id, FLOUR_ID);
  assert.equal(result.decision_source, 'admin_approved');
});

test('34. Approved mapping cannot override explicit contradictions', () => {
  const result = runMatch({
    description: 'Chicken Breast Frozen',
    invoiceUnit: 'lb',
    eligibleIngredients: [{
      id: FLOUR_ID,
      name: 'Chicken Breast Fresh',
      unit: 'oz',
    }],
    decisions: createDecisions({
      approvals: [['chicken breast frozen', FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.decision_source, 'identity_review_required');
});

test('35. An approval for one product does not authorize another', () => {
  const result = runMatch({
    description: 'Chicken Breast Frozen',
    invoiceUnit: 'lb',
    eligibleIngredients: [{
      id: FLOUR_ID,
      name: 'Chicken breast',
      unit: 'oz',
    }],
    decisions: createDecisions({
      approvals: [['chicken breast fresh', FLOUR_ID]],
    }),
  });

  assert.notEqual(result.status, 'auto');
});

test('36. Approved aliases still require compatible physical units', () => {
  const result = runMatch({
    description: 'Chicken Breast Fresh',
    invoiceUnit: 'ct',
    eligibleIngredients: [{
      id: FLOUR_ID,
      name: 'Chicken breast',
      unit: 'oz',
    }],
    decisions: createDecisions({
      approvals: [['chicken breast fresh', FLOUR_ID]],
    }),
  });

  assert.notEqual(result.status, 'auto');
});

test('37. Approval cannot match chicken breast to mozzarella', () => {
  const result = runMatch({
    description: 'Chicken Breast Fresh',
    invoiceUnit: 'lb',
    eligibleIngredients: [{
      id: FLOUR_ID,
      name: 'Mozzarella Cheese',
      unit: 'oz',
    }],
    decisions: createDecisions({
      approvals: [['chicken breast fresh', FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.decision_source, 'identity_review_required');
});

test('38. Approval cannot match salmon to broccoli', () => {
  const result = runMatch({
    description: 'Fresh Salmon Fillet',
    invoiceUnit: 'lb',
    eligibleIngredients: [{
      id: FLOUR_ID,
      name: 'Fresh Broccoli',
      unit: 'oz',
    }],
    decisions: createDecisions({
      approvals: [['fresh salmon fillet', FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.decision_source, 'identity_review_required');
});

test('39. Approval cannot match chicken breast to chicken thigh', () => {
  const result = runMatch({
    description: 'Chicken Breast Fresh',
    invoiceUnit: 'lb',
    eligibleIngredients: [{
      id: FLOUR_ID,
      name: 'Chicken Thigh Fresh',
      unit: 'oz',
    }],
    decisions: createDecisions({
      approvals: [['chicken breast fresh', FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.decision_source, 'identity_review_required');
});

test('40. Approval cannot match different ground beef fat ratios', () => {
  const result = runMatch({
    description: 'Ground Beef 80/20',
    invoiceUnit: 'lb',
    eligibleIngredients: [{
      id: FLOUR_ID,
      name: 'Ground Beef 90/10',
      unit: 'oz',
    }],
    decisions: createDecisions({
      approvals: [['ground beef 80 20', FLOUR_ID]],
    }),
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.decision_source, 'identity_review_required');
});