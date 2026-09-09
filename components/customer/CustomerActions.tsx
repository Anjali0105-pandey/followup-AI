"use client";

import { useGenerator } from "@/components/generator/GeneratorProvider";

export default function CustomerActions({ customerId }: { customerId: number }) {
  const { openGenerator } = useGenerator();
  return (
    <button
      onClick={() => openGenerator({ customerId })}
      className="focus-ring flex h-8 items-center gap-1.5 rounded-[7px] bg-brand px-3 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover"
    >
      <span>✦</span> Generate follow-up
    </button>
  );
}
