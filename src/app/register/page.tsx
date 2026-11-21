import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/AuthForms";

export const metadata: Metadata = { title: "Регистрация" };

export default function RegisterPage() {
  return <RegisterForm />;
}
