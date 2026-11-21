import type { Metadata } from "next";
import { Suspense } from "react";
import { buildCourseIndex, loadCourse } from "@/lib/content/load";
import { ProfileClient } from "@/components/profile/ProfileClient";

export const metadata: Metadata = { title: "Профиль" };

export default function ProfilePage() {
  const index = buildCourseIndex(loadCourse());
  return (
    <Suspense>
      <ProfileClient index={index} />
    </Suspense>
  );
}
