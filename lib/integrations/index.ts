/**
 * Integration surface. Nothing here talks to a real provider yet — but the
 * shapes are the ones a real connector would expose, so wiring Gmail or the
 * WhatsApp Business API later is an implementation swap, not a UI rewrite.
 */

export type ProviderId = "crm" | "email" | "calendar" | "meetings";

export interface Provider {
  id: ProviderId;
  name: string;
  description: string;
  vendors: string[];
  connected: boolean;
  /** What the product gains once this is live. */
  unlocks: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: "crm",
    name: "CRM",
    description: "Import accounts, contacts and open opportunities.",
    vendors: ["Salesforce", "HubSpot", "Pipedrive"],
    connected: false,
    unlocks: "Your real pipeline replaces the demo workspace.",
  },
  {
    id: "email",
    name: "Email",
    description: "Read customer threads to detect questions and buying signals.",
    vendors: ["Gmail", "Outlook"],
    connected: false,
    unlocks: "A live Inbox, and follow-ups that send from your own address.",
  },
  {
    id: "calendar",
    name: "Calendar",
    description: "See upcoming meetings and prepare briefings automatically.",
    vendors: ["Google Calendar", "Outlook Calendar"],
    connected: false,
    unlocks: "Meeting prep appears the morning of the call.",
  },
  {
    id: "meetings",
    name: "Meeting platform",
    description: "Pull transcripts automatically instead of pasting them.",
    vendors: ["Zoom", "Google Meet", "Teams"],
    connected: false,
    unlocks: "Commitments are extracted the moment a call ends.",
  },
];
