// Shapes shared by the server and the browser.

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  tools: string[];
};

export type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
};

export type PendingCall = {
  name: string;
  args: Record<string, unknown>;
  id: string;
};

export type Risk = "read" | "write" | "sensitive";

/** What the signed-in user may do with the pending action, computed on the server. */
export type PendingPolicy = {
  risk: Risk;
  allowed: boolean; // has the permission at all
  needsReview: boolean; // approving sends it to an admin instead of running it
};

export type Snapshot = {
  conversationId: string;
  messages: ChatMessage[];
  pending: PendingCall | null;
  policy: PendingPolicy | null;
  review: ApprovalRequest | null; // open admin review for the pending action
  sandbox?: SandboxView; // demo mode only: the visitor's pretend GitHub
};

export type SandboxView = {
  owner: string;
  repos: { name: string; private: boolean; openIssues: number; failingCi: boolean }[];
};

export type ApprovalRequest = {
  id: string;
  requesterId: string;
  requesterLogin: string | null;
  conversationId: string;
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  risk: Risk;
  status: "pending" | "approved" | "rejected" | "cancelled" | "failed";
  reviewerId: string | null;
  reviewerLogin: string | null;
  reviewNote: string;
  resultOk: boolean | null;
  resultDetail: string;
  awaitingRequester: boolean; // decided, runs when the requester is next on the site
  createdAt: string;
  reviewedAt: string | null;
};

export type AuditEntry = {
  id: string;
  conversationId: string | null;
  tool: string;
  args: Record<string, unknown>;
  decision: string;
  ok: boolean | null;
  detail: string;
  category: "github" | "admin" | "security";
  createdAt: string;
  userLogin: string | null;
  actorLogin: string | null;
};

export type ManagedUser = {
  id: string;
  name: string | null;
  image: string | null;
  login: string | null;
  role: string;
  disabled: boolean;
  lastSeenAt: string | null;
  createdAt: string | null;
  usageToday: number;
  overrides: Record<string, boolean>;
};

export type AdminStats = {
  users: number;
  activeWeek: number;
  conversations: number;
  pendingReviews: number;
  actionsToday: number;
  failuresWeek: number;
};

export type SyncedRepo = {
  githubId: string;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  description: string | null;
  language: string | null;
  defaultBranch: string | null;
  stars: number;
  openIssues: number;
  htmlUrl: string;
  pushedAt: string | null;
};
