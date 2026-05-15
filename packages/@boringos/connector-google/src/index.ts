// SPDX-License-Identifier: GPL-3.0-or-later
//
// Google Workspace HTTP clients.
// wrapper + `default-workflows.ts` were deleted with the
// connector framework — these clients are imported directly by
// the Google Module in /core/src/modules/.

export {
  GmailClient,
  buildOutgoingMime,
  encodeQuotedPrintable,
  type EmailHeaders,
} from "./gmail-client.js";
export { CalendarClient } from "./calendar-client.js";
