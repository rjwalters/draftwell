import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../[[route]]";

// Mock D1 database
function createMockDb() {
  const mockStatement = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn(),
    first: vi.fn(),
    run: vi.fn(),
  };

  return {
    prepare: vi.fn().mockReturnValue(mockStatement),
    _statement: mockStatement,
  };
}

// Mock R2 bucket
function createMockBucket() {
  return {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
}

function createContext(
  method: string,
  path: string,
  options: {
    body?: unknown;
    db?: ReturnType<typeof createMockDb>;
    bucket?: ReturnType<typeof createMockBucket>;
    cookie?: string;
    appName?: string;
  } = {},
) {
  const url = new URL(path, "http://localhost");
  const route = path.replace("/api/", "").split("/").filter(Boolean);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  const request = new Request(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return {
    request,
    env: {
      DB: options.db ?? createMockDb(),
      CONTENT_BUCKET: options.bucket ?? createMockBucket(),
      APP_NAME: options.appName ?? "test-app",
    },
    params: { route: route.length ? route : undefined },
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    next: vi.fn(),
    data: {},
  } as unknown as Parameters<typeof onRequest>[0];
}

// Helper to set up an authenticated user context
function setupAuthenticatedDb(mockDb: ReturnType<typeof createMockDb>) {
  // The first call to getSessionUser queries sessions+users join
  // We need to handle .first() calls properly
  const mockUser = {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    created_at: "2024-01-01",
  };

  // When getAuthenticatedUser is called, it does:
  // 1. getSessionIdFromCookie (no DB)
  // 2. getSessionUser: DB.prepare(SELECT u.* FROM sessions s JOIN users u...).bind(sessionId).first()
  // The mock will return mockUser on the first .first() call
  mockDb._statement.first.mockResolvedValueOnce(mockUser);

  return mockUser;
}

describe("Document API Routes", () => {
  const sessionCookie = "draftwell-session=test-session-id";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/projects/:projectId/documents", () => {
    it("returns 401 when not authenticated", async () => {
      const context = createContext("GET", "/api/projects/proj-1/documents");
      const response = await onRequest(context);
      expect(response.status).toBe(401);
    });

    it("returns 404 when project not found", async () => {
      const mockDb = createMockDb();
      setupAuthenticatedDb(mockDb);
      // verifyProjectOwnership returns null
      mockDb._statement.first.mockResolvedValueOnce(null);

      const context = createContext("GET", "/api/projects/proj-1/documents", {
        db: mockDb,
        cookie: sessionCookie,
      });
      const response = await onRequest(context);
      expect(response.status).toBe(404);
    });

    it("returns documents list", async () => {
      const mockDb = createMockDb();
      setupAuthenticatedDb(mockDb);
      // verifyProjectOwnership
      mockDb._statement.first.mockResolvedValueOnce({ id: "proj-1" });
      // documents query
      const mockDocs = [
        {
          id: "doc-1",
          project_id: "proj-1",
          title: "My Document",
          current_revision: 0,
          r2_key: "users/user-1/projects/proj-1/documents/doc-1/rev_0.md",
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
        },
      ];
      mockDb._statement.all.mockResolvedValueOnce({ results: mockDocs });

      const context = createContext("GET", "/api/projects/proj-1/documents", {
        db: mockDb,
        cookie: sessionCookie,
      });
      const response = await onRequest(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.documents).toEqual(mockDocs);
    });
  });

  describe("POST /api/projects/:projectId/documents", () => {
    it("returns 401 when not authenticated", async () => {
      const context = createContext("POST", "/api/projects/proj-1/documents", {
        body: { title: "New Doc" },
      });
      const response = await onRequest(context);
      expect(response.status).toBe(401);
    });

    it("returns 400 when title is missing", async () => {
      const mockDb = createMockDb();
      setupAuthenticatedDb(mockDb);
      // verifyProjectOwnership
      mockDb._statement.first.mockResolvedValueOnce({ id: "proj-1" });

      const context = createContext("POST", "/api/projects/proj-1/documents", {
        db: mockDb,
        cookie: sessionCookie,
        body: {},
      });
      const response = await onRequest(context);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required");
    });

    it("creates a document successfully", async () => {
      const mockDb = createMockDb();
      const mockBucket = createMockBucket();
      setupAuthenticatedDb(mockDb);
      // verifyProjectOwnership
      mockDb._statement.first.mockResolvedValueOnce({ id: "proj-1" });
      // insert document
      mockDb._statement.run.mockResolvedValueOnce({ success: true });
      // insert revision
      mockDb._statement.run.mockResolvedValueOnce({ success: true });

      const context = createContext("POST", "/api/projects/proj-1/documents", {
        db: mockDb,
        bucket: mockBucket,
        cookie: sessionCookie,
        body: { title: "My New Doc", content: "Hello world" },
      });
      const response = await onRequest(context);
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.document.title).toBe("My New Doc");
      expect(data.document.current_revision).toBe(0);
      expect(data.document.project_id).toBe("proj-1");
      expect(mockBucket.put).toHaveBeenCalledOnce();
    });
  });

  describe("GET /api/projects/:projectId/documents/:docId", () => {
    it("returns document with content", async () => {
      const mockDb = createMockDb();
      const mockBucket = createMockBucket();
      setupAuthenticatedDb(mockDb);
      // verifyProjectOwnership
      mockDb._statement.first.mockResolvedValueOnce({ id: "proj-1" });
      // get document
      const mockDoc = {
        id: "doc-1",
        project_id: "proj-1",
        title: "My Doc",
        current_revision: 0,
        r2_key: "users/user-1/projects/proj-1/documents/doc-1/rev_0.md",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      };
      mockDb._statement.first.mockResolvedValueOnce(mockDoc);
      // R2 get
      mockBucket.get.mockResolvedValueOnce({ text: () => Promise.resolve("# Hello") });

      const context = createContext("GET", "/api/projects/proj-1/documents/doc-1", {
        db: mockDb,
        bucket: mockBucket,
        cookie: sessionCookie,
      });
      const response = await onRequest(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.document).toEqual(mockDoc);
      expect(data.content).toBe("# Hello");
    });

    it("returns 404 when document not found", async () => {
      const mockDb = createMockDb();
      setupAuthenticatedDb(mockDb);
      // verifyProjectOwnership
      mockDb._statement.first.mockResolvedValueOnce({ id: "proj-1" });
      // document not found
      mockDb._statement.first.mockResolvedValueOnce(null);

      const context = createContext("GET", "/api/projects/proj-1/documents/nonexistent", {
        db: mockDb,
        cookie: sessionCookie,
      });
      const response = await onRequest(context);
      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/projects/:projectId/documents/:docId", () => {
    it("updates document content with new revision", async () => {
      const mockDb = createMockDb();
      const mockBucket = createMockBucket();
      setupAuthenticatedDb(mockDb);
      // verifyProjectOwnership
      mockDb._statement.first.mockResolvedValueOnce({ id: "proj-1" });
      // get existing doc
      mockDb._statement.first.mockResolvedValueOnce({ id: "doc-1", current_revision: 2 });
      // insert revision
      mockDb._statement.run.mockResolvedValueOnce({ success: true });
      // update document
      mockDb._statement.run.mockResolvedValueOnce({ success: true });
      // fetch updated doc
      const updatedDoc = {
        id: "doc-1",
        project_id: "proj-1",
        title: "My Doc",
        current_revision: 3,
        r2_key: "users/user-1/projects/proj-1/documents/doc-1/rev_3.md",
        created_at: "2024-01-01",
        updated_at: "2024-01-02",
      };
      mockDb._statement.first.mockResolvedValueOnce(updatedDoc);

      const context = createContext("PUT", "/api/projects/proj-1/documents/doc-1", {
        db: mockDb,
        bucket: mockBucket,
        cookie: sessionCookie,
        body: { content: "Updated content" },
      });
      const response = await onRequest(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.document.current_revision).toBe(3);
      expect(mockBucket.put).toHaveBeenCalledOnce();
    });

    it("returns 404 when document not found", async () => {
      const mockDb = createMockDb();
      setupAuthenticatedDb(mockDb);
      // verifyProjectOwnership
      mockDb._statement.first.mockResolvedValueOnce({ id: "proj-1" });
      // document not found
      mockDb._statement.first.mockResolvedValueOnce(null);

      const context = createContext("PUT", "/api/projects/proj-1/documents/nonexistent", {
        db: mockDb,
        cookie: sessionCookie,
        body: { content: "new content" },
      });
      const response = await onRequest(context);
      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/projects/:projectId/documents/:docId", () => {
    it("deletes document and cleans up R2", async () => {
      const mockDb = createMockDb();
      const mockBucket = createMockBucket();
      setupAuthenticatedDb(mockDb);
      // verifyProjectOwnership
      mockDb._statement.first.mockResolvedValueOnce({ id: "proj-1" });
      // existing doc
      mockDb._statement.first.mockResolvedValueOnce({
        id: "doc-1",
        r2_key: "key",
        current_revision: 1,
      });
      // revisions list
      mockDb._statement.all.mockResolvedValueOnce({
        results: [{ r2_key: "rev_0.md" }, { r2_key: "rev_1.md" }],
      });
      // delete
      mockDb._statement.run.mockResolvedValueOnce({ success: true });

      const context = createContext("DELETE", "/api/projects/proj-1/documents/doc-1", {
        db: mockDb,
        bucket: mockBucket,
        cookie: sessionCookie,
      });
      const response = await onRequest(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(mockBucket.delete).toHaveBeenCalledTimes(2);
    });

    it("returns 404 when document not found", async () => {
      const mockDb = createMockDb();
      setupAuthenticatedDb(mockDb);
      // verifyProjectOwnership
      mockDb._statement.first.mockResolvedValueOnce({ id: "proj-1" });
      // doc not found
      mockDb._statement.first.mockResolvedValueOnce(null);

      const context = createContext("DELETE", "/api/projects/proj-1/documents/nonexistent", {
        db: mockDb,
        cookie: sessionCookie,
      });
      const response = await onRequest(context);
      expect(response.status).toBe(404);
    });
  });
});
