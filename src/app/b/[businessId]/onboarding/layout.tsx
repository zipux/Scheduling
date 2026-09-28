import { requireBusinessPage } from "@/server/auth/context";

export default async function OnboardingLayout({ children, params }: LayoutProps<"/b/[businessId]/onboarding">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  return (
    <div className="min-h-dvh">
      <header className="flex h-14 items-center border-b px-4 font-semibold">{ctx.business.name}</header>
      <main className="mx-auto w-full max-w-lg px-4 py-6">{children}</main>
    </div>
  );
}
