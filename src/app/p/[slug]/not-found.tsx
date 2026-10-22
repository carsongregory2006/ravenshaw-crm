export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-white px-6 text-center text-[#333]">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-[#666]">This page doesn&apos;t exist or is no longer published.</p>
    </div>
  );
}
