import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card mx-auto max-w-lg p-6 text-center">
      <h1 className="t-h1">Not found</h1>
      <p className="t-meta mt-1.5">That customer, meeting or opportunity doesn&apos;t exist — it may have been deleted.</p>
      <Link
        href="/"
        className="focus-ring mt-4 inline-block rounded-[7px] bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-hover"
      >
        Back to Command Center
      </Link>
    </div>
  );
}
