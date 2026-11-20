import { createProjectionCalendarHandler } from '../projections/calendar.js';

// The shared handler uses requireAdmin, including MFA, in this mode.
export default createProjectionCalendarHandler({ adminMode: true });