import { PageSkeleton } from "@/components/app/page-skeleton";

// Only on routes that never answer 404: a loading boundary starts the response
// before the page runs, so notFound() below it would be sent with status 200.
export default function Loading() {
  return <PageSkeleton />;
}
