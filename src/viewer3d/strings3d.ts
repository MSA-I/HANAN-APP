/**
 * Hebrew UI strings owned by the 3D viewer. Kept local so this module stays
 * self-contained; the app lead may fold these into ui/strings.ts later.
 *
 * ⚠ NOTHING in `viewer3d/` may carry inline Hebrew. Every user-visible word in a
 * 3D component comes from here or from `ui/strings.ts` — the selection bar used
 * to spell 'שכפול' and 'מחיקה' straight into its JSX, which is exactly how a
 * label ends up meaning two different things in two panes.
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
    duplicateShort: 'שכפול',
    delete: 'מחיקת הנבחרים · Delete',
    deleteShort: 'מחיקה',
    more: 'פעולות נוספות',
    /** what the pinned label over the selected table reads */
    seatsLabel: (count: number) => `${count} מקומות`,
  },
  /** The bar's own controls — the popover triggers and the rotation cluster. */
  bar: {
    seats: 'מספר מקומות',
    seatsAdd: 'הוספת מקום',
    seatsRemove: 'הסרת מקום',
    chairs: 'כיסאות',
    chairsTitle: 'מספר מקומות, מרווח ודגם הכיסא',
    design: 'עיצוב',
    designTitle: 'עיצוב השולחן וערכות הסכו״ם',
    height: 'גובה',
    heightTitle: 'גובה התלייה',
    rotateCw: 'סיבוב 45° עם כיוון השעון',
    rotateCcw: 'סיבוב 45° נגד כיוון השעון',
    rotationValue: (deg: number) => `${deg}°`,
    close: 'סגירה',
  },
  fallback: {
    title: 'לא ניתן להציג תצוגת תלת-ממד',
    body: 'הדפדפן או המכשיר אינם תומכים ב-WebGL, או שהאצת החומרה כבויה. נסו דפדפן עדכני או הפעילו האצת גרפיקה בהגדרות.',
  },
  /**
   * One line per `HintId` from `core/viewerHints.ts`. The hint used to be a
   * single frozen string that was wallpaper within a minute; these say what the
   * hand that is already moving can do next.
   */
  hint: {
    idle: 'W·A·S·D / חצים · Q/E גובה · Shift מהיר · Space איטי · ימני — מבט · גלגלת — קדימה',
    selection: 'גררו להזזה · טבעת הסיבוב מסובבת · ימני — מבט',
    dragMove: 'שחררו למיקום · Alt עוקף הצמדה · Ctrl+Z לביטול',
    dragRotate: 'שחררו לסיום · Shift מצמיד ל-45° · Ctrl+Z לביטול',
    orbit: 'סיבוב סביב המוקד — שחררו את O למבט חופשי',
    placing: 'קליק להצבה · Alt משאיר את הפריט דרוך · Esc לביטול',
    designEdit: 'עריכת עיצוב — גררו פריטים על השולחן · Esc ליציאה',
    help: 'כל הקיצורים',
  },
  /**
   * The first-run navigation card. The Lumion scheme is not changing (the user
   * was shown that Planner 5D, Home Designer and Chief Architect all default to
   * left-drag orbit and chose to keep this and fix DISCOVERY instead), so this
   * card is the fix: it says out loud what the three buttons do.
   */
  navCard: {
    title: 'ניווט בתלת־ממד',
    rightButton: 'לחצן ימני — מבט',
    middleButton: 'לחצן אמצעי — הזזה',
    wheel: 'גלגלת — קדימה/אחורה',
    leftButton: 'לחצן שמאלי — בחירה וגרירה',
    keys: 'W·A·S·D או חצים לתנועה · Q/E גובה · Shift מהיר · Space איטי',
    gotIt: 'הבנתי',
    never: 'אל תציגו שוב',
  },
} as const
