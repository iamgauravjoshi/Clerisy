// Starting with Windows: the rules for the login item, kept free of Electron so they can be tested on their own.

/** Passed by the login item, so a launch at sign-in starts quietly in the tray instead of opening the window. */
export const HIDDEN_ARG = '--hidden'

export const isHiddenLaunch = (argv: readonly string[]): boolean => argv.includes(HIDDEN_ARG)

/**
 * Whether to (re)write the login item.
 * - On a user's change of the setting: always, so turning it on also re-enables an entry Windows had switched off.
 * - Otherwise (at startup): only when the registered entry disagrees with the setting. Startup apps that the user
 *   switched off in Task Manager or Windows Settings keep their entry, so they stay off instead of being re-enabled.
 */
export function shouldWriteLoginItem(wanted: boolean, registered: boolean, userChanged: boolean): boolean {
  return userChanged || wanted !== registered
}
