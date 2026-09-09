import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCustomer,
  listContacts,
  listInteractions,
  listOpportunitiesFor,
  listSignals,
} from "@/lib/repo/customers";
import { listCommitmentsForCustomer } from "@/lib/repo/commitments";
import { Avatar, Badge, HealthPill, PriorityChip, SectionTitle, StageBadge, AiMark, EmptyState } from "@/components/ui";
import CustomerTabs from "@/components/customer/CustomerTabs";
import CustomerActions from "@/components/customer/CustomerActions";
import Timeline from "@/components/customer/Timeline";
import CommitmentList from "@/components/commitments/CommitmentList";
import { money } from "@/lib/format";
import { relativeDue, relativePast } from "@/lib/dates";
import type { SignalKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const SIGNAL_SECTIONS: { kind: SignalKind; title: string; tone: "positive" | "risk" | "attention" | "neutral" }[] = [
  { kind: "buying", title: "Buying signals", tone: "positive" },
  { kind: "objection", title: "Objections", tone: "risk" },
  { kind: "question", title: "Open questions", tone: "attention" },
  { kind: "risk", title: "Risk signals", tone: "risk" },
  { kind: "competitor", title: "Competitors", tone: "neutral" },
];

export default async function Customer360(props: PageProps<"/customers/[id]">) {
  const { id } = await props.params;
  const customerId = Number(id);
  const customer = getCustomer(customerId);
  if (!customer) notFound();

  const contacts = listContacts(customerId);
  const opportunities = listOpportunitiesFor(customerId);
  const interactions = listInteractions(customerId);
  const signals = listSignals(customerId).filter((s) => !s.resolved_at);
  const commitments = listCommitmentsForCustomer(customerId);

  const primary = contacts.find((c) => c.is_decision_maker) ?? contacts[0];
  const openOpp = opportunities.find((o) => o.stage !== "won" && o.stage !== "lost") ?? opportunities[0];
  const mine = commitments.filter((c) => c.owner === "me" && c.status !== "done");
  const theirs = commitments.filter((c) => c.owner === "customer" && c.status !== "done");
  const nextAction = mine[0];

  return (
    <>
      {/* ---------- Header ---------- */}
      <div className="mb-6">
        <Link href="/customers" className="t-meta mb-2 inline-block text-[12px] hover:text-ink">
          ← Customers
        </Link>

        <div className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <Avatar name={customer.company} size={44} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="t-h1">{customer.company}</h1>
                  <HealthPill health={customer.health} />
                  {openOpp && <PriorityChip band={openOpp.priority_band} score={openOpp.priority_score} reasons={openOpp.priority_reasons} />}
                </div>
                <p className="t-meta mt-1">
                  {customer.industry}
                  {customer.segment ? ` · ${customer.segment}` : ""}
                  {customer.website ? ` · ${customer.website}` : ""}
                </p>
                {primary && (
                  <p className="t-meta mt-2 flex flex-wrap items-center gap-x-2.5">
                    <span className="font-medium text-ink">{primary.name}</span>
                    <span>{primary.role}</span>
                    {primary.email && <a href={`mailto:${primary.email}`} className="text-brand hover:underline">{primary.email}</a>}
                    {primary.phone && <span>{primary.phone}</span>}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <CustomerActions customerId={customerId} />
              {openOpp && (
                <div className="text-right">
                  <div className="tabular text-[20px] font-semibold leading-none">{money(openOpp.value)}</div>
                  <div className="mt-1.5 flex items-center justify-end gap-1.5">
                    <StageBadge stage={openOpp.stage} />
                    <span className="t-meta text-[12px]">{openOpp.probability}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* The single most important line on the page. */}
          <div className="mt-4 grid gap-3 border-t border-line-soft pt-4 sm:grid-cols-3">
            <Fact label="Next action">
              {nextAction ? (
                <>
                  {nextAction.title}{" "}
                  <span className={nextAction.due_date < new Date().toISOString().slice(0, 10) ? "text-risk" : "text-ink-3"}>
                    · {relativeDue(nextAction.due_date)}
                  </span>
                </>
              ) : (
                <span className="text-attention">Nothing scheduled — book one</span>
              )}
            </Fact>
            <Fact label="Last interaction">{relativePast(interactions[0]?.occurred_at ?? null)}</Fact>
            <Fact label="Open commitments">
              {mine.length} yours · {theirs.length} theirs
            </Fact>
          </div>
        </div>
      </div>

      <CustomerTabs
        tabs={[
          {
            key: "overview",
            label: "Overview",
            content: (
              <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-6">
                  {customer.ai_summary && (
                    <section>
                      <SectionTitle>
                        <span className="flex items-center gap-1.5">
                          <AiMark /> Account summary
                        </span>
                      </SectionTitle>
                      <div className="ai-block px-4 py-3">
                        <p className="text-[13.5px] leading-6">{customer.ai_summary}</p>
                      </div>
                    </section>
                  )}

                  {SIGNAL_SECTIONS.map((sec) => {
                    const rows = signals.filter((s) => s.kind === sec.kind);
                    if (rows.length === 0) return null;
                    return (
                      <section key={sec.kind}>
                        <SectionTitle>{sec.title}</SectionTitle>
                        <ul className="card divide-y divide-line-soft">
                          {rows.map((s) => (
                            <li key={s.id} className="px-4 py-2.5">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[13.5px]">{s.label}</p>
                                  {s.detail && <p className="t-meta mt-0.5 text-[12.5px]">{s.detail}</p>}
                                </div>
                                <Badge tone={sec.tone}>{"●".repeat(s.strength)}</Badge>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}

                  {openOpp && openOpp.priority_reasons.length > 0 && (
                    <section>
                      <SectionTitle>
                        <span className="flex items-center gap-1.5">
                          <AiMark /> Why this account is ranked {openOpp.priority_band}
                        </span>
                      </SectionTitle>
                      <ul className="card space-y-1 px-4 py-3">
                        {openOpp.priority_reasons.map((r) => (
                          <li key={r} className="text-[13px] text-ink-2">
                            • {r}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>

                <aside className="space-y-5">
                  <Card title="Known facts">
                    {Object.keys(customer.facts).length > 0 ? (
                      <dl className="space-y-2">
                        {Object.entries(customer.facts).map(([k, v]) => (
                          <div key={k}>
                            <dt className="t-label">{k.replace(/_/g, " ")}</dt>
                            <dd className="text-[13px] leading-5">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="t-meta text-[12.5px]">Nothing recorded yet. Log a meeting to build account memory.</p>
                    )}
                  </Card>

                  <Card title={`Contacts (${contacts.length})`}>
                    <ul className="space-y-2.5">
                      {contacts.map((c) => (
                        <li key={c.id} className="flex items-start gap-2.5">
                          <Avatar name={c.name} size={26} />
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-[13px] font-medium">
                              {c.name}
                              {c.is_decision_maker && <Badge tone="brand">DM</Badge>}
                              {c.is_champion && <Badge tone="positive">Champion</Badge>}
                            </p>
                            <p className="t-meta truncate text-[12px]">{c.role}</p>
                            {c.email && (
                              <a href={`mailto:${c.email}`} className="block truncate text-[12px] text-brand hover:underline">
                                {c.email}
                              </a>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>

                  {opportunities.length > 0 && (
                    <Card title="Opportunities">
                      <ul className="space-y-2">
                        {opportunities.map((o) => (
                          <li key={o.id} className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-[13px]">{o.name}</p>
                              <StageBadge stage={o.stage} />
                            </div>
                            <span className="tabular shrink-0 text-[13px] font-medium">{money(o.value)}</span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}
                </aside>
              </div>
            ),
          },
          {
            key: "timeline",
            label: "Timeline",
            count: interactions.length,
            content:
              interactions.length > 0 ? (
                <Timeline interactions={interactions} />
              ) : (
                <EmptyState title="No history yet" body="Log a meeting or a call to start building this account's memory." />
              ),
          },
          {
            key: "commitments",
            label: "Commitments",
            count: mine.length + theirs.length,
            content:
              commitments.length > 0 ? (
                <CommitmentList items={commitments} showOwner groupByDue />
              ) : (
                <EmptyState title="No commitments" body="Nothing promised in either direction." />
              ),
          },
        ]}
      />
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="t-label">{label}</div>
      <p className="mt-0.5 text-[13.5px]">{children}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h3 className="t-label mb-2.5">{title}</h3>
      {children}
    </div>
  );
}
