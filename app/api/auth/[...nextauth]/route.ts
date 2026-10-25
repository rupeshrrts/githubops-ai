// GET/POST /api/auth/*: Auth.js runs the whole "Sign in with GitHub" OAuth flow here (see backend/auth.ts).
import { handlers } from "@/backend/auth";

export const { GET, POST } = handlers;
