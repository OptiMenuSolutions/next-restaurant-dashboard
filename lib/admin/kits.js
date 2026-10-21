// lib/admin/kits.js
// Tag kit rules shared by the Tag kits API routes.
//
// A tag's stage, from the kit and the tag itself:
//   0 not written · 1 written (test tap confirmed) · 2 packed · 3 sent or
//   handed off · 4 delivered · 5 placed (the first real tap picked a spot)
// Tags stay 'pending' until the kit is delivered. Pending tags answer a tap
// with a "this tag works" check instead of the staff page.

export const KIT_SIZE = { plan: 3, replacement: 1 };

// What one kit takes off the shelf when it is packed.
export function kitUsage(kind, tagCount) {
  if (kind === 'plan') return { tags: tagCount, boxes: 1, foam: 1, cards: 1 };
  if (kind === 'replacement') return { tags: tagCount };
  return { tags: tagCount }; // add-on tags go in an envelope or come with you
}

export function tagStage(tag, kit) {
  if (tag.spot && tag.status === 'active') return 5;
  if (kit?.delivered_at) return 4;
  if (kit?.sent_at) return 3;
  if (kit?.packed_at) return 2;
  if (tag.confirmed_at) return 1;
  return 0;
}

// The next thing to do for a kit, and which wizard step it opens on.
export function kitNext(kit, tags) {
  if (!tags.every((t) => t.confirmed_at)) return { step: 2, text: 'Write the tags' };
  if (!kit.packed_at) return { step: 3, text: 'Pack the box' };
  if (!kit.sent_at) return { step: 4, text: kit.delivery === 'mail' ? 'Print the label and mail it' : 'Hand it off' };
  if (!kit.delivered_at) return { step: null, text: 'Waiting for delivery' };
  const unplaced = tags.filter((t) => !t.spot).length;
  if (unplaced) return { step: null, text: `${unplaced} not tapped yet` };
  return { step: null, text: 'Done' };
}