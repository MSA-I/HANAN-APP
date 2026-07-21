/**
 * Hebrew UI strings owned by the 3D viewer. Kept local so this module stays
 * self-contained; the app lead may fold these into ui/strings.ts later.
 */
export const strings3d = {
  presets: {
    overview: 'מבט כללי',
    top: 'מבט עליון',
    eye: 'גובה עיניים',
    reset: 'איפוס מבט',
  },
  capture: {
    title: 'צלם תמונה זו (1536×1024) — נשמרת ל-HANAN-APP-DOCS\\צילומים',
  },
  selection: {
    one: 'פריט אחד נבחר',
    many: (count: number) => `${count} פריטים נבחרו`,
    duplicate: 'שכפול הנבחרים · Ctrl+D',
    delete: 'מחיקת הנבחרים · Delete',
  },
  fallback: {
    title: 'לא ניתן להציג תצוגת תלת-ממד',
    body: 'הדפדפן או המכשיר אינם תומכים ב-WebGL, או שהאצת החומרה כבויה. נסו דפדפן עדכני או הפעילו האצת גרפיקה בהגדרות.',
  },
  fly: {
    hint: 'W·A·S·D / חצים · Q/E גובה · Shift מהיר · Space איטי · ימני — מבט · גלגלת — קדימה',
  },
} as const
