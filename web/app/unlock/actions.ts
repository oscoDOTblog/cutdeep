"use server";

import { redirect } from "next/navigation";
import { adminDestination, endAdminSession, startAdminSession } from "../lib/admin-auth";

export async function unlock(_message: string, form: FormData): Promise<string> {
  if (!(await startAdminSession(form.get("password")))) return "Incorrect password. Try again.";
  redirect(adminDestination(form.get("next")));
}

export async function logout(): Promise<void> {
  await endAdminSession();
  redirect("/unlock?next=%2Fsettings");
}
