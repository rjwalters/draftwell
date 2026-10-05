// Cloudflare Pages Functions API handler
// Thin router that dispatches to domain modules

import {
  handleCompareDocuments,
  handleGenerateRefinement,
  handleGenerateReview,
  handleGenerateRevision,
  handleGetReview,
  handleGetReviews,
  handleScoreDocument,
  handleUpdateReviewItem,
} from "../lib/ai";
import { handleWritingCheck } from "../lib/anvil";
import {
  getAuthenticatedUser,
  handleDeleteMe,
  handleGetMe,
  handleHealthCheck,
  handleLogin,
  handleLogout,
  handleRefreshSession,
  handleRegister,
  handleUpdateMe,
} from "../lib/auth";
import { handleAcceptCandidate } from "../lib/candidates";
import { withDiagnostics } from "../lib/diagnostics";
import {
  handleCreateDocument,
  handleDeleteDocument,
  handleGetDocument,
  handleGetDocuments,
  handleUpdateDocument,
} from "../lib/documents";
import { handleGenerateDraft } from "../lib/drafting";
import { handleGoogleAuth, handleGoogleCallback } from "../lib/google-auth";
import {
  handleCreateProject,
  handleDeleteProject,
  handleGetProject,
  handleGetProjects,
  handleUpdateProject,
} from "../lib/projects";
import { error } from "../lib/shared";
import type { Env } from "../lib/types";
import {
  handleAnalyzeVoice,
  handleDeleteVoiceProfile,
  handleGetVoiceProfile,
  handleGetVoiceProfiles,
} from "../lib/voice";

// Main request handler
export const onRequest: PagesFunction<Env> = (context) =>
  withDiagnostics(context, () => dispatch(context));

const dispatch = async (context: Parameters<PagesFunction<Env>>[0]): Promise<Response> => {
  const { request, env, params } = context;
  const method = request.method;

  // Parse route from catch-all parameter
  const route = (params.route as string[])?.join("/") || "";
  const path = `/api/${route}`;

  // Health check
  if (path === "/api/health" && method === "GET") {
    return await handleHealthCheck(env);
  }

  // Auth endpoints
  if (path === "/api/auth/login" && method === "POST") {
    return await handleLogin(env, request);
  }

  if (path === "/api/auth/logout" && method === "POST") {
    return await handleLogout(env, request);
  }

  if (path === "/api/auth/register" && method === "POST") {
    return await handleRegister(env, request);
  }

  if (path === "/api/auth/me" && method === "GET") {
    return await handleGetMe(env, request);
  }

  if (path === "/api/auth/me" && method === "PUT") {
    return await handleUpdateMe(env, request);
  }

  if (path === "/api/auth/me" && method === "DELETE") {
    return await handleDeleteMe(env, request);
  }

  if (path === "/api/auth/refresh" && method === "POST") {
    return await handleRefreshSession(env, request);
  }

  // Google OAuth (redirect-based flow)
  if (path === "/api/auth/google" && method === "GET") {
    return await handleGoogleAuth(env, request);
  }

  if (path === "/api/auth/google/callback" && method === "GET") {
    return await handleGoogleCallback(env, request);
  }

  // Projects endpoints (require authentication via session cookie)
  if (path === "/api/projects" && method === "GET") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleGetProjects(env, user.id);
  }

  if (path === "/api/projects" && method === "POST") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleCreateProject(env, request, user.id);
  }

  const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch) {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    const projectId = projectMatch[1];

    if (method === "GET") {
      return await handleGetProject(env, projectId, user.id);
    }
    if (method === "PUT") {
      return await handleUpdateProject(env, request, projectId, user.id);
    }
    if (method === "DELETE") {
      return await handleDeleteProject(env, projectId, user.id);
    }
  }

  // Document endpoints (require authentication)
  const docsMatch = path.match(/^\/api\/projects\/([^/]+)\/documents$/);
  if (docsMatch) {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    const projectId = docsMatch[1];

    if (method === "GET") {
      return await handleGetDocuments(env, projectId, user.id);
    }
    if (method === "POST") {
      return await handleCreateDocument(env, request, projectId, user.id);
    }
  }

  const docMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)$/);
  if (docMatch) {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    const projectId = docMatch[1];
    const docId = docMatch[2];

    if (method === "GET") {
      return await handleGetDocument(env, projectId, docId, user.id);
    }
    if (method === "PUT") {
      return await handleUpdateDocument(env, request, projectId, docId, user.id);
    }
    if (method === "DELETE") {
      return await handleDeleteDocument(env, projectId, docId, user.id);
    }
  }

  const candidateMatch = path.match(
    /^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/candidates\/([^/]+)\/accept$/,
  );
  if (candidateMatch && method === "POST") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleAcceptCandidate(
      env,
      candidateMatch[1],
      candidateMatch[2],
      candidateMatch[3],
      user.id,
    );
  }
  const checkMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/writing-check$/);
  if (checkMatch && method === "POST") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleWritingCheck(env, request, checkMatch[1], checkMatch[2], user.id);
  }

  const draftMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/draft$/);
  if (draftMatch && method === "POST") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleGenerateDraft(env, request, draftMatch[1], draftMatch[2], user.id);
  }

  // AI Review endpoints
  const reviewGenerateMatch = path.match(
    /^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/review$/,
  );
  if (reviewGenerateMatch && method === "POST") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleGenerateReview(
      env,
      request,
      reviewGenerateMatch[1],
      reviewGenerateMatch[2],
      user.id,
    );
  }

  const reviewsListMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/reviews$/);
  if (reviewsListMatch && method === "GET") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleGetReviews(env, reviewsListMatch[1], reviewsListMatch[2], user.id);
  }

  const reviewDetailMatch = path.match(
    /^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/reviews\/([^/]+)$/,
  );
  if (reviewDetailMatch && method === "GET") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleGetReview(
      env,
      reviewDetailMatch[1],
      reviewDetailMatch[2],
      reviewDetailMatch[3],
      user.id,
    );
  }

  const reviewItemMatch = path.match(
    /^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/reviews\/([^/]+)\/items\/([^/]+)$/,
  );
  if (reviewItemMatch && method === "PATCH") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleUpdateReviewItem(
      env,
      request,
      reviewItemMatch[1],
      reviewItemMatch[2],
      reviewItemMatch[3],
      reviewItemMatch[4],
      user.id,
    );
  }

  const reviseMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/revise$/);
  if (reviseMatch && method === "POST") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleGenerateRevision(env, request, reviseMatch[1], reviseMatch[2], user.id);
  }

  const refineMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/refine$/);
  if (refineMatch && method === "POST") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleGenerateRefinement(env, request, refineMatch[1], refineMatch[2], user.id);
  }

  const scoreMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/score$/);
  if (scoreMatch && method === "POST") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleScoreDocument(env, request, scoreMatch[1], scoreMatch[2], user.id);
  }

  const compareMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/compare$/);
  if (compareMatch && method === "POST") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleCompareDocuments(env, request, compareMatch[1], compareMatch[2], user.id);
  }

  // Voice profile endpoints (require authentication)
  if (path === "/api/voice/profiles" && method === "GET") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleGetVoiceProfiles(env, user.id);
  }

  if (path === "/api/voice/analyze" && method === "POST") {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    return await handleAnalyzeVoice(env, request, user.id);
  }

  const voiceProfileMatch = path.match(/^\/api\/voice\/profiles\/([^/]+)$/);
  if (voiceProfileMatch) {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return error("Unauthorized", 401);
    const profileId = voiceProfileMatch[1];

    if (method === "GET") {
      return await handleGetVoiceProfile(env, profileId, user.id);
    }
    if (method === "DELETE") {
      return await handleDeleteVoiceProfile(env, profileId, user.id);
    }
  }

  // 404 for unknown routes
  return error("Not found", 404);
};
