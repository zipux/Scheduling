"use client";

import { useParams } from "next/navigation";
import { ErrorView } from "@/components/app/error-view";

/** Keeps the business shell (header, navigation) around a failed page. */
export default function BusinessError(props: { error: Error & { digest?: string }; retry: () => void }) {
  const { businessId } = useParams<{ businessId: string }>();
  return <ErrorView {...props} home={`/b/${businessId}`} />;
}
