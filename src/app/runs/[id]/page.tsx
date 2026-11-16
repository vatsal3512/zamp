import { Suspense } from "react";
import { StoredRunPage } from "@/components/run/run-pages";

export default function Page() {
  return (
    <Suspense>
      <StoredRunPage />
    </Suspense>
  );
}
