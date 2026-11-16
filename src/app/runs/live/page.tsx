import { Suspense } from "react";
import { LiveRunPage } from "@/components/run/run-pages";

export default function Page() {
  return (
    <Suspense>
      <LiveRunPage />
    </Suspense>
  );
}
