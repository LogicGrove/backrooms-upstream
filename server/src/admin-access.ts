/** Admin rights are an explicit local operator configuration, never a registrable name. */
export function isAdminAccount(uid: number, configured = process.env.ADMIN_UID ?? '') {
  if (!/^[1-9][0-9]*$/.test(configured)) return false;
  const expected = Number(configured);
  return Number.isSafeInteger(expected) && Number.isSafeInteger(uid) && uid === expected;
}
