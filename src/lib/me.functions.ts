import { createServerFn } from "@tanstack/react-start";
import { getSessionUser } from "./auth.server";

export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const u = await getSessionUser();
  if (!u) return { user: null as null | { id: string; email: string; name: string; role: string } };
  return { user: { id: u.id, email: u.email, name: u.name, role: u.role } };
});
