/** The user + role columns needed to decide who is signed in and what they may do. */
import { roles, users } from "@/db/schema";

export const userRowColumns = {
  id: users.id,
  username: users.username,
  fullName: users.fullName,
  email: users.email,
  isActive: users.isActive,
  mustChangePw: users.mustChangePw,
  sessionEpoch: users.sessionEpoch,
  roleId: roles.id,
  roleName: roles.name,
  isSuper: roles.isSuper,
  permissions: roles.permissions,
};

export interface UserRow {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  isActive: boolean;
  mustChangePw: boolean;
  sessionEpoch: number;
  roleId: number | null;
  roleName: string | null;
  isSuper: boolean | null;
  permissions: string[] | null;
}
