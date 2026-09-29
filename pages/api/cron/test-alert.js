// TEMPORARY: sends one test alert. Delete after testing.
import { sendCronAlert } from '../../../lib/cronAlert';

const TEST_TOKEN = '997a063d5b4254c46d281f2b1afcff62';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  await sendCronAlert('Test alert', 'This is a test. If you got this email, cron alerts work.', ['Example detail line']);
  return res.status(200).json({ sent: true });
}