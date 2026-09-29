// TEMPORARY: sends one test alert. Delete after testing.
import { sendCronAlert } from '../../../lib/cronAlert';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  await sendCronAlert('Test alert', 'This is a test. If you got this email, cron alerts work.', ['Example detail line']);
  return res.status(200).json({ sent: true });
}