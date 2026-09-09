/** Skeletons mirror the real layout so the page doesn't jump when data lands. */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6">
        <div className="h-7 w-64 rounded bg-sunken" />
        <div className="mt-2 h-4 w-96 rounded bg-sunken" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="card h-[86px]" />
        ))}
      </div>
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card h-[168px]" />
        ))}
      </div>
    </div>
  );
}
