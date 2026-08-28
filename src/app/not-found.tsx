import Link from "next/link";

/**
 * Also the destination for `notFound()` thrown by an access check.
 *
 * Project access failures return 404 rather than 403 so ids cannot be probed,
 * which means this page is shown both to someone who mistyped a URL and to
 * someone poking at a project they cannot see. The wording has to work for both
 * without confirming that the second kind of page exists.
 */
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 py-10">
      <div className="panel w-full max-w-[440px] p-8">
        <p className="eyebrow">NOT FOUND</p>
        <h1 className="display mb-3 mt-2 text-[26px]">
          There is nothing here
        </h1>
        <p className="mb-6 text-[12px] text-fg-muted">
          This page does not exist, or it is not yours to open.
        </p>
        <Link href="/" className="btn-primary">
          Back to inbox
        </Link>
      </div>
    </main>
  );
}
