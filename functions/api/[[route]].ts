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
import {
  handleCreateDocument,
  handleDeleteDocument,
  handleGetDocument,
  handleGetDocuments,
  handleUpdateDocument,
} from "../lib/documents";
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
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const method = request.method;

  // Parse route from catch-all parameter
  const route = (params.route as string[])?.join("/") || "";
  const path = `/api/${route}`;

  try {
    // Health check
    if (path === "/api/health" && method === "GET") {
      return handleHealthCheck(env);
    }

    // Auth endpoints
    if (path === "/api/auth/login" && method === "POST") {
      return handleLogin(env, request);
    }

    if (path === "/api/auth/logout" && method === "POST") {
      return handleLogout(env, request);
    }

    if (path === "/api/auth/register" && method === "POST") {
      return handleRegister(env, request);
    }

    if (path === "/api/auth/me" && method === "GET") {
      return handleGetMe(env, request);
    }

    if (path === "/api/auth/me" && method === "PUT") {
      return handleUpdateMe(env, request);
    }

    if (path === "/api/auth/me" && method === "DELETE") {
      return handleDeleteMe(env, request);
    }

    if (path === "/api/auth/refresh" && method === "POST") {
      return handleRefreshSession(env, request);
    }

    // Projects endpoints (require authentication via session cookie)
    if (path === "/api/projects" && method === "GET") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleGetProjects(env, user.id);
    }

    if (path === "/api/projects" && method === "POST") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleCreateProject(env, request, user.id);
    }

    const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch) {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      const projectId = projectMatch[1];

      if (method === "GET") {
        return handleGetProject(env, projectId, user.id);
      }
      if (method === "PUT") {
        return handleUpdateProject(env, request, projectId, user.id);
      }
      if (method === "DELETE") {
        return handleDeleteProject(env, projectId, user.id);
      }
    }

    // Document endpoints (require authentication)
    const docsMatch = path.match(/^\/api\/projects\/([^/]+)\/documents$/);
    if (docsMatch) {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      const projectId = docsMatch[1];

      if (method === "GET") {
        return handleGetDocuments(env, projectId, user.id);
      }
      if (method === "POST") {
        return handleCreateDocument(env, request, projectId, user.id);
      }
    }

    const docMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)$/);
    if (docMatch) {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      const projectId = docMatch[1];
      const docId = docMatch[2];

      if (method === "GET") {
        return handleGetDocument(env, projectId, docId, user.id);
      }
      if (method === "PUT") {
        return handleUpdateDocument(env, request, projectId, docId, user.id);
      }
      if (method === "DELETE") {
        return handleDeleteDocument(env, projectId, docId, user.id);
      }
    }

    // AI Review endpoints
    const reviewGenerateMatch = path.match(
      /^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/review$/,
    );
    if (reviewGenerateMatch && method === "POST") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleGenerateReview(
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
      return handleGetReviews(env, reviewsListMatch[1], reviewsListMatch[2], user.id);
    }

    const reviewDetailMatch = path.match(
      /^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/reviews\/([^/]+)$/,
    );
    if (reviewDetailMatch && method === "GET") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleGetReview(
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
      return handleUpdateReviewItem(
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
      return handleGenerateRevision(env, request, reviseMatch[1], reviseMatch[2], user.id);
    }

    const refineMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/refine$/);
    if (refineMatch && method === "POST") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleGenerateRefinement(env, request, refineMatch[1], refineMatch[2], user.id);
    }

    const scoreMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/score$/);
    if (scoreMatch && method === "POST") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleScoreDocument(env, request, scoreMatch[1], scoreMatch[2], user.id);
    }

    const compareMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/compare$/);
    if (compareMatch && method === "POST") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleCompareDocuments(env, request, compareMatch[1], compareMatch[2], user.id);
    }

    // Voice profile endpoints (require authentication)
    if (path === "/api/voice/profiles" && method === "GET") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleGetVoiceProfiles(env, user.id);
    }

    if (path === "/api/voice/analyze" && method === "POST") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleAnalyzeVoice(env, request, user.id);
    }

    const voiceProfileMatch = path.match(/^\/api\/voice\/profiles\/([^/]+)$/);
    if (voiceProfileMatch) {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      const profileId = voiceProfileMatch[1];

      if (method === "GET") {
        return handleGetVoiceProfile(env, profileId, user.id);
      }
      if (method === "DELETE") {
        return handleDeleteVoiceProfile(env, profileId, user.id);
      }
    }

    // 404 for unknown routes
    return error("Not found", 404);
  } catch (e) {
    console.error("API error:", e);
    return error("Internal server error", 500);
  }
};
