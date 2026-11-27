import { readWasteAssessment } from '../../../lib/wasteAssessmentReader.js';

export function createWasteAssessmentHandler({ db, verifyOwner } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    if (Object.keys(req.query || {}).length) {
      return res.status(400).json({ error: 'Unexpected waste assessment query fields.' });
    }
    try {
      const services = !db || !verifyOwner ? await import('../../../lib/scannerAuth') : null;
      const auth = await (verifyOwner || services.requireOwner)(req);
      if (auth.error) return res.status(auth.status || 401).json({ error: auth.error });
      if (!auth.user?.id || !auth.restaurant?.id) {
        return res.status(401).json({ error: 'Please sign in again.' });
      }
      const result = await readWasteAssessment(db || services.admin, auth.restaurant.id);
      return res.status(200).json(result);
    } catch (error) {
      console.error('[waste-assessment]', error.code || 'READ_FAILED');
      return res.status(503).json({ error: 'Could not load the waste assessment.' });
    }
  };
}

export default createWasteAssessmentHandler();