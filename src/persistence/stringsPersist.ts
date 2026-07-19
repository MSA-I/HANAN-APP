/**
 * Hebrew strings owned by the persistence/dashboard slice. Kept separate so the
 * lead can merge them into src/ui/strings.ts. Function-valued entries build a
 * localized phrase from a count or name.
 */
export const stringsPersist = {
  dashboard: {
    wordmark: 'מתכנן אירועים',
    newEvent: 'אירוע חדש',
    loadError: 'טעינת הפרויקטים נכשלה',
    retry: 'נסו שוב',
    emptyTitle: 'תכננו את האירוע הראשון שלכם',
    emptyBody: 'סדרו שולחנות, כיסאות ועמדות — ותראו את האולם מתמלא.',
    noDate: 'ללא תאריך',
    openProject: 'פתיחת הפרויקט',
    moreActions: 'פעולות נוספות',
    menuDelete: 'מחיקה',
  },
  deleteModal: {
    title: 'מחיקת אירוע',
    body: (name: string) => `למחוק את "${name}"? הפעולה אינה הפיכה.`,
    confirm: 'מחיקת אירוע',
    cancel: 'ביטול',
  },
  newModal: {
    title: 'אירוע חדש',
    projectName: 'שם הפרויקט',
    projectNamePlaceholder: 'לדוגמה: חתונת דנה ויוסי',
    eventName: 'שם האירוע',
    eventNamePlaceholder: 'רשות',
    date: 'תאריך',
    venueWidth: 'רוחב האולם (מ׳)',
    venueDepth: 'עומק האולם (מ׳)',
    floorColor: 'צבע רצפה',
    layoutLabel: 'תוכן התחלתי',
    startBlank: 'ריק',
    startSample: 'פריסה לדוגמה',
    create: 'יצירת אירוע',
    cancel: 'ביטול',
  },
  /** relative-time phrase parts, consumed by formatRelativeTime */
  relativeTime: {
    justNow: 'עכשיו',
    minuteOne: 'לפני דקה',
    minutes: (n: number) => `לפני ${n} דקות`,
    hourOne: 'לפני שעה',
    hours: (n: number) => `לפני ${n} שעות`,
    dayOne: 'אתמול',
    days: (n: number) => `לפני ${n} ימים`,
    weekOne: 'לפני שבוע',
    weeks: (n: number) => `לפני ${n} שבועות`,
    monthOne: 'לפני חודש',
    months: (n: number) => `לפני ${n} חודשים`,
    yearOne: 'לפני שנה',
    years: (n: number) => `לפני ${n} שנים`,
  },
} as const
