import { useCallback, useEffect, useState } from "react";

export interface VoiceDimension {
  name: string;
  observation: string;
  rule: string;
}

export interface VoiceProfileData {
  dimensions: VoiceDimension[];
  summary: string;
  escape_clause: string;
}

export interface VoiceProfile {
  id: string;
  user_id: string;
  name: string;
  profile_data: string;
  created_at: string;
  updated_at: string;
}

export interface VoiceSample {
  id: string;
  sample_text: string | null;
  source_url: string | null;
  word_count: number;
  created_at: string;
}

interface UseVoiceProfileReturn {
  profiles: VoiceProfile[];
  activeProfile: VoiceProfile | null;
  samples: VoiceSample[];
  isLoading: boolean;
  isAnalyzing: boolean;
  error: string | null;
  fetchProfiles: () => Promise<void>;
  fetchProfile: (id: string) => Promise<void>;
  analyzeVoice: (
    samples: Array<{ text: string; source_url?: string }>,
    name?: string,
  ) => Promise<VoiceProfile | null>;
  deleteProfile: (id: string) => Promise<void>;
  parseProfileData: (profile: VoiceProfile) => VoiceProfileData | null;
}

async function fetchWithCredentials(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

export function useVoiceProfile(): UseVoiceProfileReturn {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<VoiceProfile | null>(null);
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithCredentials("/api/voice/profiles");
      if (!res.ok) {
        const data = (await res.json()) as { error: string };
        throw new Error(data.error);
      }
      const data = (await res.json()) as { profiles: VoiceProfile[] };
      setProfiles(data.profiles);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchProfile = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithCredentials(`/api/voice/profiles/${id}`);
      if (!res.ok) {
        const data = (await res.json()) as { error: string };
        throw new Error(data.error);
      }
      const data = (await res.json()) as { profile: VoiceProfile; samples: VoiceSample[] };
      setActiveProfile(data.profile);
      setSamples(data.samples);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const analyzeVoice = useCallback(
    async (
      sampleInputs: Array<{ text: string; source_url?: string }>,
      name?: string,
    ): Promise<VoiceProfile | null> => {
      setIsAnalyzing(true);
      setError(null);
      try {
        const res = await fetchWithCredentials("/api/voice/analyze", {
          method: "POST",
          body: JSON.stringify({ samples: sampleInputs, name }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error: string };
          throw new Error(data.error);
        }
        const data = (await res.json()) as { profile: VoiceProfile };
        setProfiles((prev) => [data.profile, ...prev]);
        setActiveProfile(data.profile);
        return data.profile;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setIsAnalyzing(false);
      }
    },
    [],
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const res = await fetchWithCredentials(`/api/voice/profiles/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = (await res.json()) as { error: string };
          throw new Error(data.error);
        }
        setProfiles((prev) => prev.filter((p) => p.id !== id));
        if (activeProfile?.id === id) {
          setActiveProfile(null);
          setSamples([]);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [activeProfile],
  );

  const parseProfileData = useCallback((profile: VoiceProfile): VoiceProfileData | null => {
    try {
      return JSON.parse(profile.profile_data) as VoiceProfileData;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  return {
    profiles,
    activeProfile,
    samples,
    isLoading,
    isAnalyzing,
    error,
    fetchProfiles,
    fetchProfile,
    analyzeVoice,
    deleteProfile,
    parseProfileData,
  };
}
