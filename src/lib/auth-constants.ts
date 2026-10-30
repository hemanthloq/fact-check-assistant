/**
 * Auth values shared between the edge middleware and the Node server.
 *
 * Kept separate from auth.ts because that module imports `server-only`, `pg` and `bcryptjs`
 * -- none of which can be bundled into the edge runtime where middleware executes.
 */
export const SESSION_COOKIE = "fca_session";
export const SESSION_TTL = "7d";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
