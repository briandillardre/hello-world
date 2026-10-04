/**
 * What a button says when a server action's reply never arrived. Next 14
 * resolves a call whose response isn't a server-action payload — a gateway
 * 502, a function timeout's 504, a captive portal — to `undefined` instead of
 * throwing, so read every result as `r?.ok` / `r?.error ?? NO_REPLY`; a bare
 * `r.ok` throws inside the handler and leaves the button stuck.
 */
export const NO_REPLY = "Didn't hear back from the server — check the connection and try again."
