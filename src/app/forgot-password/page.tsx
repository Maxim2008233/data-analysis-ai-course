import type { Metadata } from "next";
import { ForgotForm } from "@/components/auth/AuthForms";

export const metadata: Metadata = { title: "Восстановление пароля" };

export default function ForgotPage() {
  return <ForgotForm />;
}
