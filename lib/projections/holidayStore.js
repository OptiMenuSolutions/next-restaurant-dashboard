import { resolveProjectionSettings } from './settings.js';
import { shiftProjectionDate } from './businessTime.js';
import { selectProjectionCalendarVersion } from './calendarStore.js';
import { classifyProjectionCalendarNight } from './calendar.js';
import { holidayError,buildHolidayFactors } from './holidayFactors.js';
import { buildHolidayLearning } from './holidayLearning.js';

function checked(reply) {
  if(!reply || reply.error || !reply.data || typeof reply.data!=='object' || Array.isArray(reply.data)){
    const error=new Error(reply?.error?.message||'Invalid holiday database response.');error.code=reply?.error?.code||'PROJECTION_HOLIDAY_READ_FAILED';throw error;
  }
  return reply.data;
}
export async function readProjectionHolidays(db,{restaurantId,asOf,snapshotAt}) {
  const args={p_restaurant_id:restaurantId,p_as_of:asOf,p_snapshot_at:snapshotAt};
  let raw=checked(await db.rpc('projection_holiday_context',args));
  if(raw.restaurant_id!==restaurantId||raw.as_of!==asOf||raw.calendar_context?.restaurant_id!==restaurantId)holidayError('Holiday database context does not match.');
  shiftProjectionDate(raw.calendar_context.from,0);shiftProjectionDate(raw.calendar_context.until,0);
  const prepared=await db.rpc('projection_prepare_calendar',{p_from:raw.calendar_context?.from,p_until:raw.calendar_context?.until});
  if(!prepared||prepared.error||!Object.hasOwn(prepared,'data'))holidayError(prepared?.error?.message||'Holiday calendar preparation failed.');
  raw=checked(await db.rpc('projection_holiday_context',args));
  if(raw.restaurant_id!==restaurantId || raw.as_of!==asOf || !/^[a-f0-9]{64}$/.test(raw.context_digest||''))holidayError('Holiday database context does not match.');
  const resolvedSettings=resolveProjectionSettings({restaurantId,at:snapshotAt,globalVersion:raw.global_version,restaurantVersion:raw.restaurant_version});
  const ctx=raw.calendar_context;
  if(ctx?.restaurant_id!==restaurantId || ctx.today!==asOf || ![ctx.versions,ctx.holidays,ctx.rules,ctx.history,ctx.holiday_answers].every(Array.isArray))holidayError('Incomplete holiday calendar context.');
  for(let year=Number(asOf.slice(0,4));year<=Number(ctx.until.slice(0,4));year++){
    if(asOf<`${year}-03-01`&&ctx.until>=`${year}-02-01`&&!ctx.scheduled_years?.includes(year))holidayError(`The ${year} Super Bowl date needs a published calendar entry.`);
  }
  const calendar=Array.from({length:resolvedSettings.settings.horizon_days},(_,i)=>{
    const date=shiftProjectionDate(asOf,i),configuration=selectProjectionCalendarVersion(ctx.versions,restaurantId,date);
    return {...classifyProjectionCalendarNight({restaurantId,date,configuration,holidays:ctx.holidays,rules:ctx.rules,asOf:snapshotAt,
      earlyCloseFactor:resolvedSettings.settings.early_close_factor,today:asOf,history:ctx.history,holidayAnswers:ctx.holiday_answers,
      thresholdUnits:ctx.closure_conflict_threshold_units}),restaurant_id:restaurantId,configuration_revision:configuration.revision,context_digest:raw.context_digest};
  });
  const learning=buildHolidayLearning({restaurantId,asOf,snapshotAt,resolvedSettings,modelVersion:raw.model_version,
    firstDataDate:raw.first_data_date,history:raw.history,holidays:ctx.holidays,holidayAnswers:ctx.holiday_answers,archives:raw.archives,
    closureThresholdUnits:ctx.closure_conflict_threshold_units,context_digest:raw.context_digest});
  const usable=new Set(learning.observations.map(row=>row.business_date));
  const excludedDates=[...new Set(raw.observations.filter(row=>row.business_date<asOf&&!usable.has(row.business_date)).map(row=>row.business_date))].sort();
  const factors=buildHolidayFactors({restaurantId,asOf,snapshotAt,resolvedSettings,calendar,rules:ctx.rules,observations:raw.observations,excludedDates});
  return {learning,factors,calendar,resolvedSettings,modelVersion:raw.model_version,history:raw.history,firstDataDate:raw.first_data_date};
}
export async function storeProjectionHolidays(db,plan) {
  if(!/^[a-f0-9]{64}$/.test(plan?.source_context_digest||''))holidayError('A database-fenced holiday plan is required.');
  const result=checked(await db.rpc('projection_store_holidays',{p_restaurant_id:plan.restaurant_id,p_as_of:plan.as_of,
    p_snapshot_at:plan.snapshot_at,p_context_digest:plan.source_context_digest,p_plan:plan}));
  if(!Number.isSafeInteger(result.saved)||result.saved<0||typeof result.retry!=='boolean')holidayError('Invalid holiday write response.');
  return result;
}