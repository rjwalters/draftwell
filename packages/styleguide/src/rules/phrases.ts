import type { StyleguideRule } from "../types.js";

/**
 * Banned phrases: kill-on-sight AI writing tells.
 * Sources: writewell SKILL.md (AI Pattern Removal), autonovel ANTI-SLOP.md
 */
export const bannedPhrases: StyleguideRule[] = [
  // -- Significance inflation --
  {
    id: "phrase-important-to-note",
    description: "Filler phrase that inflates significance",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\b(?:it(?:'s| is) (?:important|worth|crucial|essential) to (?:note|mention|remember|understand|recognize|acknowledge))\\b",
    suggestion: "Remove the phrase and state the point directly.",
  },
  {
    id: "phrase-it-bears-mentioning",
    description: "Hedging filler that inflates significance",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\bit bears (?:mentioning|noting|emphasizing)\\b",
    suggestion: "Remove and state the point directly.",
  },
  {
    id: "phrase-this-is-particularly",
    description: "Significance inflation with vague emphasis",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\bthis is (?:particularly|especially|notably) (?:important|significant|relevant|noteworthy|crucial)\\b",
    suggestion: "Remove or explain why it matters concretely.",
  },
  {
    id: "phrase-cannot-be-overstated",
    description: "Hyperbolic significance inflation",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\bcannot be (?:overstated|understated|overemphasized)\\b",
    suggestion: "State the actual significance with evidence.",
  },

  // -- Promotional / breathless language --
  {
    id: "phrase-game-changer",
    description: "Promotional buzzword",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\bgame[- ]?changer\\b",
    suggestion: "Describe the specific impact instead.",
  },
  {
    id: "phrase-groundbreaking",
    description: "Promotional language",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\bgroundbreaking\\b",
    suggestion: "Describe what makes it significant with specifics.",
  },
  {
    id: "phrase-cutting-edge",
    description: "Promotional buzzword",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\bcutting[- ]?edge\\b",
    suggestion: "Describe the specific technical advancement.",
  },
  {
    id: "phrase-revolutionize",
    description: "Promotional hyperbole",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\brevolutioni[sz](?:e|es|ed|ing)\\b",
    suggestion: "Describe the specific change or improvement.",
  },
  {
    id: "phrase-paradigm-shift",
    description: "Promotional buzzword",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\bparadigm shift\\b",
    suggestion: "Describe the specific change.",
  },

  // -- Vague attributions --
  {
    id: "phrase-many-experts",
    description: "Vague attribution without sources",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\b(?:many|some|several|numerous|various) (?:experts|researchers|scholars|analysts|studies|professionals) (?:believe|argue|suggest|note|point out|have (?:shown|found|noted))\\b",
    suggestion: "Cite specific sources or remove the claim.",
  },
  {
    id: "phrase-widely-regarded",
    description: "Vague unsourced claim",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\b(?:widely|generally|universally|commonly) (?:regarded|considered|recognized|acknowledged|accepted) as\\b",
    suggestion: "Cite specific sources or state as your own assessment.",
  },

  // -- Filler transitions --
  {
    id: "phrase-dive-into",
    description: "AI-typical transition phrase",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\b(?:let(?:'s| us)|we'll|I'll) (?:dive|delve|dig) (?:deep(?:er)?\\s+)?into\\b",
    suggestion: "Remove the transition and begin the content directly.",
  },
  {
    id: "phrase-in-today",
    description: "Chatbot-style opener",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\bin today(?:'s| 's) (?:article|post|guide|blog|piece|essay|discussion|world|landscape|environment)\\b",
    suggestion: "Remove the opener.",
  },
  {
    id: "phrase-without-further-ado",
    description: "Filler transition",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\bwithout (?:further|any further) ado\\b",
    suggestion: "Remove and proceed to the content.",
  },
  {
    id: "phrase-in-conclusion",
    description: "Unnecessary conclusion marker (often AI-generated)",
    severity: "warning",
    category: "banned-phrase",
    pattern: "\\bin conclusion\\b",
    suggestion: "Remove and let the concluding content speak for itself.",
  },
  {
    id: "phrase-in-summary",
    description: "Unnecessary summary marker",
    severity: "warning",
    category: "banned-phrase",
    pattern: "\\bin summary\\b",
    suggestion: "Remove and let the summary content speak for itself.",
  },

  // -- Chatbot artifacts --
  {
    id: "phrase-as-an-ai",
    description: "Chatbot self-identification artifact",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\bas an (?:AI|artificial intelligence|language model|LLM)\\b",
    suggestion: "Remove — this is a chatbot artifact.",
  },
  {
    id: "phrase-i-dont-have-opinions",
    description: "Chatbot disclaimer artifact",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\bI (?:don't|do not|cannot) (?:have|hold|express) (?:personal )?(?:opinions|beliefs|feelings|emotions)\\b",
    suggestion: "Remove — this is a chatbot artifact.",
  },
  {
    id: "phrase-happy-to-help",
    description: "Chatbot pleasantry",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\b(?:happy|glad|pleased) to (?:help|assist)\\b",
    suggestion: "Remove — this is a chatbot artifact.",
  },
  {
    id: "phrase-hope-this-helps",
    description: "Chatbot closing artifact",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\b(?:I )?hope (?:this|that) (?:helps|is helpful|answers your)\\b",
    suggestion: "Remove — this is a chatbot artifact.",
  },
  {
    id: "phrase-feel-free-to",
    description: "Chatbot permission artifact",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\bfeel free to\\b",
    suggestion: "Remove or rephrase as a direct instruction.",
  },
  {
    id: "phrase-great-question",
    description: "Chatbot flattery artifact",
    severity: "error",
    category: "banned-phrase",
    pattern: "\\b(?:great|good|excellent|fantastic|wonderful) question\\b",
    suggestion: "Remove — this is a chatbot artifact.",
  },

  // -- Hedging phrases --
  {
    id: "phrase-it-should-be-noted",
    description: "Passive hedging filler",
    severity: "warning",
    category: "banned-phrase",
    pattern: "\\bit should be (?:noted|mentioned|pointed out|emphasized|stressed)\\b",
    suggestion: "Remove and state the point directly.",
  },
  {
    id: "phrase-having-said-that",
    description: "Filler transition hedge",
    severity: "warning",
    category: "banned-phrase",
    pattern: "\\b(?:having said that|that (?:being )?said|with that (?:being )?said)\\b",
    suggestion: "Use 'but', 'however', or restructure.",
  },

  // -- Connective tissue / padding --
  {
    id: "phrase-serves-as",
    description: "Indirect construction common in AI writing",
    severity: "warning",
    category: "banned-phrase",
    pattern: "\\bserves as (?:a|an|the)\\b",
    suggestion: "Use 'is' or describe the function directly.",
  },
  {
    id: "phrase-plays-a-crucial-role",
    description: "Vague significance padding",
    severity: "warning",
    category: "banned-phrase",
    pattern: "\\bplays a (?:crucial|vital|key|important|significant|pivotal|critical) role\\b",
    suggestion: "Describe the specific contribution.",
  },
  {
    id: "phrase-at-its-core",
    description: "Filler phrase",
    severity: "warning",
    category: "banned-phrase",
    pattern: "\\bat its (?:core|heart|essence)\\b",
    suggestion: "Remove and state the point directly.",
  },
  {
    id: "phrase-when-it-comes-to",
    description: "Wordy transition",
    severity: "warning",
    category: "banned-phrase",
    pattern: "\\bwhen it comes to\\b",
    suggestion: "Replace with 'for' or 'regarding', or restructure.",
  },
  {
    id: "phrase-in-the-realm-of",
    description: "Pretentious filler",
    severity: "warning",
    category: "banned-phrase",
    pattern: "\\bin the (?:realm|world|arena|domain|sphere) of\\b",
    suggestion: "Replace with 'in' or remove entirely.",
  },
];
