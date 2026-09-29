"use client";

import { ErrorView } from "@/components/app/error-view";

export default function RootError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main id="main" tabIndex={-1}>
      <ErrorView {...props} />
    </main>
  );
}
