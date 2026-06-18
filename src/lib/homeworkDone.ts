/**
 * Per-student "homework done" checklist, stored locally (per device).
 *
 * Students read homework through the read-only `lesson_details_student` view and
 * have no place to write a server-side completion flag, so this is a personal,
 * client-side marker: it closes the "do homework → mark done → it's acknowledged"
 * loop and lets the dashboard count drop, without a tutor-facing submission.
 */
const keyFor = (userId: string) => `tutorhub.hwDone.${userId}`;

export function readHomeworkDone(userId: string | undefined | null): Set<string> {
  if (!userId) return new Set();
  try {
    const raw = localStorage.getItem(keyFor(userId));
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function writeHomeworkDone(userId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(Array.from(ids)));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
