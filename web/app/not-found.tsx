import Link from "next/link";

export default function NotFound() {
  return (
    <div className="panel mx-auto max-w-lg px-6 py-16 text-center">
      <div className="label mb-2">Error · 404</div>
      <h1 className="section-title text-3xl">This page is not on the register.</h1>
      <p className="mt-2 text-[var(--muted)]">
        The record you were looking for could not be found.
      </p>
      <Link href="/" className="btn btn-primary mt-6">
        Return to the register
      </Link>
    </div>
  );
}
