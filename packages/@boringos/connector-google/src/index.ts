// SPDX-License-Identifier: AGPL-3.0-or-later

// Connector definition
export { googleConnector } from "./definition.js";

// Service definitions (for module manifest declarations)
export { gmailService, calendarService, contactsService, driveService } from "./scopes.js";

// Scope constants
export { GMAIL_SCOPES, CALENDAR_SCOPES, CONTACTS_SCOPES, DRIVE_SCOPES, PROFILE_SCOPES } from "./scopes.js";

// Typed clients (v2)
export { GmailClient as GmailClientV2 } from "./services/gmail/index.js";
export { CalendarClient as CalendarClientV2 } from "./services/calendar/index.js";
export { PeopleClient } from "./services/contacts/index.js";
export { DriveClient } from "./services/drive/index.js";

// Service types
export type { GmailMessage, Thread, HistoryEvent, EmailHeaders } from "./services/gmail/index.js";
export type { CalendarEvent, FreeBusySlot } from "./services/calendar/index.js";
export type { Contact, ContactGroup } from "./services/contacts/index.js";
export type { DriveFile } from "./services/drive/index.js";

// Helpers
export { fetchWithAuth, resolveToken, type TokenSource } from "./helpers.js";

// Deprecated (kept for Phase 1 backward compatibility; removed in Phase 2 Task 2.9)
export {
  GmailClient,        // legacy executeAction-based client
  buildOutgoingMime,
  encodeQuotedPrintable,
} from "./gmail-client.js";
export { CalendarClient } from "./calendar-client.js";
