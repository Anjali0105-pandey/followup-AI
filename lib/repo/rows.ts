import type {
  Commitment,
  Contact,
  Customer,
  Interaction,
  Opportunity,
  Signal,
} from "@/lib/types";

// Row -> entity mappers. Booleans are stored as 0/1 smallints, and JSON
// columns are a mix: jsonb columns arrive already parsed from the driver,
// while `facts` is still TEXT and arrives as a string. Every read goes through
// here so that decoding lives in exactly one place.

type Row = Record<string, unknown>;

function json<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  // jsonb columns are decoded by the driver before they reach us.
  if (typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toCustomer(r: Row): Customer {
  return {
    ...(r as unknown as Customer),
    facts: json<Record<string, string>>(r.facts, {}),
  };
}

export function toContact(r: Row): Contact {
  return {
    ...(r as unknown as Contact),
    is_decision_maker: !!r.is_decision_maker,
    is_champion: !!r.is_champion,
  };
}

export function toOpportunity(r: Row): Opportunity {
  return {
    ...(r as unknown as Opportunity),
    priority_reasons: json<string[]>(r.priority_reasons, []),
    risk_reasons: json<string[]>(r.risk_reasons, []),
  };
}

export function toInteraction(r: Row): Interaction {
  return r as unknown as Interaction;
}

export function toSignal(r: Row): Signal {
  return r as unknown as Signal;
}

export function toCommitment(r: Row): Commitment {
  return r as unknown as Commitment;
}
